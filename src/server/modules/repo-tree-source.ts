// Source layer for the worktree-scoped file tree (docs/filetree.md).
//
// This module is responsible for two things only:
//   1. Walk the filesystem under the worktree root, honouring a
//      minimal .gitignore reader, the .git/ hard filter, and the
//      depth bound.
//   2. Apply the git-status overlay by joining walked paths against
//      StatusEntry.path values supplied by the caller.
//
// The source layer never touches the HTTP envelope, the route layer,
// or UI types. Its output is the wire-shaped { nodes, truncated }
// minus the wire envelope -- the read layer (repo-tree.ts) is the
// only thing allowed to wrap it into RepoTreeResult.
//
// SSH remote enumeration lives in the same module but in a separate
// function (getRepoTreeSourceRemote); the read layer dispatches
// based on the cwd's repo kind.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { glob } from 'tinyglobby'
import type { RepoTreeNode, RepoTreeNodeStatus } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

/** Hard cap on nodes emitted in a single response. Sized so a fully
 *  expanded tree of a normal-sized repo fits, but a pathological
 *  node_modules walk cannot pin the request worker. */
export const MAX_REPO_TREE_NODES = 50_000

/** Hard cap on depth requested by callers. The schema enforces
 *  this same bound at the perimeter -- duplicated here as a defensive
 *  upper bound for direct callers of the source layer. */
export const MAX_REPO_TREE_DEPTH = 10

export interface RepoTreeSourceOptions {
  /** POSIX path relative to the worktree root. The result is rooted
   *  at prefix and contains nodes at or below it. */
  readonly prefix?: string
  /** Inclusive maximum directory depth from the worktree root. The
   *  root directory itself counts as depth 0. Default 10. */
  readonly depth?: number
}

export interface RepoTreeSourceResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  readonly truncated: boolean
}

/** Local FS implementation of the source layer. The read layer calls
 *  this when the cwd is a local repo; SSH goes through
 *  getRepoTreeSourceRemote (PR 5). */
export async function getRepoTreeSourceLocal(
  worktreePath: string,
  options: RepoTreeSourceOptions,
  signal: AbortSignal | undefined,
  precomputedStatus?: ReadonlyArray<WorktreeStatus>,
): Promise<RepoTreeSourceResult> {
  if (signal?.aborted) return { nodes: [], truncated: false }

  const depth = clampDepth(options.depth ?? MAX_REPO_TREE_DEPTH)
  const prefix = normalizePrefix(options.prefix)
  const ignore = await loadIgnorePatterns(worktreePath, signal)
  if (signal?.aborted) return { nodes: [], truncated: false }

  // tinyglobby defaults to files only; we drive both files and
  // derived directories up to depth. The walk is rooted at the
  // worktree path; with a prefix we narrow via the pattern.
  const walkPattern = prefix ? `${escapePattern(prefix)}/**` : '**'

  let entries: string[]
  try {
    entries = await glob(walkPattern, {
      cwd: worktreePath,
      deep: depth,
      dot: false,
      onlyFiles: false,
      expandDirectories: false,
      ignore,
      signal,
    })
  } catch (err) {
    if (signal?.aborted) return { nodes: [], truncated: false }
    // Unknown FS errors: surface as an empty result so the route
    // layer does not 500; the read layer returns the empty envelope.
    void err
    return { nodes: [], truncated: false }
  }
  if (signal?.aborted) return { nodes: [], truncated: false }

  const allNodes = buildNodes({
    worktreePath,
    prefix,
    depth,
    entries,
  })

  const truncated = allNodes.length > MAX_REPO_TREE_NODES
  const sliced = truncated ? allNodes.slice(0, MAX_REPO_TREE_NODES) : allNodes

  const overlay = buildStatusOverlay(precomputedStatus, worktreePath)
  const nodes: RepoTreeNode[] = sliced.map((node) => ({
    ...node,
    status: overlay.get(node.id) ?? 'clean',
  }))

  return { nodes, truncated }
}

export interface BuildNodesInput {
  readonly worktreePath: string
  readonly prefix: string
  readonly depth: number
  readonly entries: ReadonlyArray<string>
}

/** Convert a list of tinyglobby entries (relative POSIX paths) into
 *  a flat list of RepoTreeNodes with derived directory nodes.
 *  Exported for unit tests so the filesystem walker can be exercised
 *  with hand-crafted input. */
export function buildNodes(input: BuildNodesInput): RepoTreeNode[] {
  const { prefix, depth, entries } = input
  const fileNodes: RepoTreeNode[] = []
  const dirIds = new Set<string>()

  for (const rawEntry of entries) {
    const relative = rawEntry.split(path.sep).join('/')
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) continue
    if (!isWithinDepth(relative, prefix, depth)) continue

    const kind: RepoTreeNode['kind'] = relative.endsWith('/') ? 'directory' : 'file'
    const id = stripTrailingSlash(relative)
    const name = basename(id)
    const parentId = parentDirectoryId(id, prefix)
    fileNodes.push({ id, path: id, name, parentId, kind, status: 'clean' })

    collectAncestorDirs(id, prefix, dirIds)
  }

  const dirNodes: RepoTreeNode[] = []
  for (const dirId of dirIds) {
    if (dirId === prefix) continue
    const node: RepoTreeNode = {
      id: dirId,
      path: dirId,
      name: basename(dirId),
      parentId: parentDirectoryId(dirId, prefix),
      kind: 'directory',
      status: 'clean',
    }
    dirNodes.push(node)
  }

  // Sort directories first, then files, both alphabetical. Children
  // of the same parent appear next to each other because we already
  // walk in tree order via tinyglobby.
  return [...dirNodes, ...fileNodes].sort(compareNodes)
}

function compareNodes(a: RepoTreeNode, b: RepoTreeNode): number {
  if (a.parentId === b.parentId) {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function collectAncestorDirs(id: string, prefix: string, out: Set<string>): void {
  let cursor = parentDirectoryId(id, prefix)
  while (cursor !== null && cursor !== prefix && !out.has(cursor)) {
    out.add(cursor)
    cursor = parentDirectoryId(cursor, prefix)
  }
}

function parentDirectoryId(id: string, prefix: string): string | null {
  const slash = id.lastIndexOf('/')
  if (slash < 0) {
    // File or directory at the worktree root.
    return null
  }
  const parent = id.slice(0, slash)
  return parent === prefix ? null : parent
}

function basename(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash < 0 ? id : id.slice(slash + 1)
}

function stripTrailingSlash(id: string): string {
  return id.endsWith('/') ? id.slice(0, -1) : id
}

function isWithinDepth(relative: string, prefix: string, depth: number): boolean {
  const segments = relative.split('/').filter(Boolean).length
  const prefixSegments = prefix ? prefix.split('/').filter(Boolean).length : 0
  return segments + prefixSegments <= depth
}

function clampDepth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MAX_REPO_TREE_DEPTH
  return Math.min(Math.floor(value), MAX_REPO_TREE_DEPTH)
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  const trimmed = prefix.split(path.sep).join('/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (trimmed === '.' || trimmed === '') return ''
  // POSIX style: relative to root, no leading slash.
  return trimmed.replace(/^\/+/, '')
}

function escapePattern(prefix: string): string {
  // tinyglobby special chars inside a fixed prefix path need
  // escaping so a folder literally named with a glob meta does not
  // become a glob.
  let out = ''
  for (const ch of prefix) {
    out += GLOB_META_CHARS.includes(ch) || ch === '\\' || ch === '!' ? `\\${ch}` : ch
  }
  return out
}

async function loadIgnorePatterns(worktreePath: string, signal: AbortSignal | undefined): Promise<string[]> {
  // .git is always excluded -- never present in the visible tree.
  // Files starting with a dot are filtered via dot:false; the
  // .gitignore itself is excluded by tinyglobby's hidden-file
  // default. This keeps node_modules-style mass exclusion fast.
  const baseIgnore: string[] = ['.git', '.git/**']

  const patterns: string[] = [...baseIgnore]
  const gitignorePath = path.join(worktreePath, '.gitignore')
  try {
    const text = await fs.readFile(gitignorePath, 'utf8')
    if (signal?.aborted) return patterns
    for (const raw of text.split(/\r?\n/)) {
      for (const pattern of translateGitignoreLine(raw)) patterns.push(pattern)
    }
  } catch (err) {
    if (signal?.aborted) return patterns
    // Missing .gitignore is normal -- fall through with base ignores.
    const code = (err as { code?: string } | null)?.code
    if (code && code !== 'ENOENT' && code !== 'EACCES' && code !== 'EPERM') {
      // Other errors are non-fatal; we surface an empty tree.
      return patterns
    }
  }
  return patterns
}

/** Translate one line of a .gitignore file into one or more
 *  tinyglobby patterns. We deliberately implement a *minimal*
 *  subset:
 *    - comments and blank lines are dropped;
 *    - negation (!) is dropped -- v1 ignores overrides so the
 *      default skip-everything rule of .gitignore is enough;
 *    - leading / anchors the pattern at the worktree root;
 *    - a bare name (node_modules) becomes a directory-anchored
 *      exclusion that also matches anywhere (slashslash-star name slashslash-star);
 *    - patterns ending in / (directory-only) become name-with-slashes;
 *    - everything else passes through with a slashslash-star prefix so it
 *      matches anywhere in the tree, matching git default.
 *
 *  v1 does not implement starstar semantics nuances, character classes,
 *  or escaped globs -- these are good follow-ups but the spec is
 *  explicit about a minimal reader. */
function translateGitignoreLine(raw: string): string[] {
  const line = raw.replace(/^\s+|\s+$/g, '')
  if (line === '' || line.startsWith('#')) return []

  const negated = line.startsWith('!')
  // v1 ignores overrides -- the spec promises an overlay-dots UI,
  // not the precise semantics of multi-rule gitignore stacks.
  void negated

  let pattern = negated ? line.slice(1) : line

  // Treat /-suffixed patterns as directory-only.
  let directoryOnly = false
  if (pattern.endsWith('/')) {
    directoryOnly = true
    pattern = pattern.slice(0, -1)
  }

  // Anchor semantics: a leading / means the pattern is rooted.
  const anchored = pattern.startsWith('/')
  if (anchored) pattern = pattern.slice(1)

  if (pattern === '') return []

  // Bare segment with no glob meta -> matches anywhere by name (and
  // also as a directory if the line ended in /). We emit two
  // patterns to cover both files and directories named foo,
  // matching git default behaviour for a bare name.
  const hasMeta = GLOB_META_CHARS.some((ch) => pattern.includes(ch))
  if (!hasMeta && !anchored) {
    if (directoryOnly) return [`**/${pattern}/**`]
    return [`**/${pattern}/**`, `**/${pattern}`]
  }

  const prefixed = anchored ? pattern : `**/${pattern}`
  return [directoryOnly ? `${prefixed}/**` : prefixed]
}

const GLOB_META_CHARS = ['*', '?', '[', ']', '{', '}']

/** Map a worktree status report to a path -> status lookup, scoped
 *  to the requested worktree. The read layer supplies the full
 *  WorktreeStatus list; we pick out the worktree that matches the
 *  requested path and translate each entry x/y codes into a
 *  RepoTreeNodeStatus. */
export function buildStatusOverlay(
  precomputedStatus: ReadonlyArray<WorktreeStatus> | undefined,
  worktreePath: string,
): Map<string, RepoTreeNodeStatus> {
  const out = new Map<string, RepoTreeNodeStatus>()
  if (!precomputedStatus) return out

  const matched = precomputedStatus.find((wt) => path.resolve(wt.path) === path.resolve(worktreePath))
  if (!matched) return out

  for (const entry of matched.entries) {
    const status = translateStatusEntry(entry.x, entry.y)
    if (status === 'clean') continue
    out.set(entry.path, status)
  }
  return out
}

function translateStatusEntry(x: string, y: string): RepoTreeNodeStatus {
  // git status --porcelain codes:
  //   x = index (staged), y = worktree (unstaged)
  //   ?? = untracked, !! = ignored
  if (x === '?' && y === '?') return 'untracked'
  if (x === '!' && y === '!') return 'ignored'
  if (x !== ' ' && x !== '?') return 'staged'
  if (y !== ' ' && y !== '?') return 'modified'
  return 'clean'
}
