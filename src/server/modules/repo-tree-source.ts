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
//
// Public surface (the only stable contract):
//   - getRepoTreeSourceLocal / getRepoTreeSourceRemote -- the two
//     fetchers the read layer calls.
//   - MAX_REPO_TREE_NODES / MAX_REPO_TREE_DEPTH -- the bounds the
//     wire schema enforces at the perimeter.
//   - RepoTreeSourceOptions / RepoTreeSourceResult -- the option /
//     result shapes.
// Pure transforms behind the fetchers (buildNodes, buildStatusOverlay,
// the NUL parser, the path-prefix stripper) live in
// `repo-tree-source-pure.ts` and are NOT re-exported from here --
// tests import them directly from the pure module. This keeps the
// source layer's public surface narrow.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { glob } from 'tinyglobby'
import type { RepoTreeNode } from '#/shared/api-types.ts'
import type { WorktreeInfo, WorktreeStatus } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { getRemoteTreeWalk } from '#/system/ssh/git.ts'
import {
  buildNodes,
  buildStatusOverlay,
  parseNullSeparatedPaths,
  stripRemoteEntryPrefix,
} from '#/server/modules/repo-tree-source-pure.ts'

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

  // Keep the source stream file-only and derive directories from file
  // paths in buildNodes. Neither tinyglobby nor remote find preserve
  // enough type information in the string path alone to distinguish an
  // empty directory from a file without extra stat calls, and v1 does
  // not need to surface empty directories.
  const walkPattern = prefix ? `${escapePattern(prefix)}/**` : '**'

  let entries: string[]
  try {
    entries = await glob(walkPattern, {
      cwd: worktreePath,
      deep: depth,
      dot: false,
      onlyFiles: true,
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

export interface GetRepoTreeSourceRemoteInput {
  readonly target: RemoteRepoTarget
  readonly worktreePath: string
  readonly options: RepoTreeSourceOptions
  readonly signal: AbortSignal | undefined
  readonly precomputedStatus: ReadonlyArray<WorktreeStatus> | undefined
  /** Worktree list from `getRemoteStatusAndWorktrees`. When supplied
   *  the underlying `getRemoteTreeWalk` skips its own
   *  `gitWorktreeList` round trip -- the second SSH call on the
   *  remote `/tree` read path becomes the only one. */
  readonly knownWorktrees?: ReadonlyArray<WorktreeInfo>
}

/** SSH implementation of the source layer. The remote side runs a
 *  bounded `find` over the worktree root (the same `.git` hard
 *  filter as the local walker), returns NUL-separated absolute
 *  POSIX paths, and the local process builds the same node shape
 *  via `buildNodes` so the view and status overlay are unchanged.
 *
 *  v1 deliberately does not apply a `.gitignore` filter on the
 *  remote. The gitignore parsing lives in `translateGitignoreLine`
 *  on the local side; piping every pattern to `find -not -path`
 *  would make the command long, error-prone, and easy to break
 *  with embedded characters. The local walker remains the source
 *  of truth for gitignore semantics. */
export async function getRepoTreeSourceRemote(input: GetRepoTreeSourceRemoteInput): Promise<RepoTreeSourceResult> {
  const { target, worktreePath, options, signal, precomputedStatus, knownWorktrees } = input
  if (signal?.aborted) return { nodes: [], truncated: false }

  const depth = clampDepth(options.depth ?? MAX_REPO_TREE_DEPTH)
  const prefix = normalizePrefix(options.prefix)

  let remoteResult
  try {
    remoteResult = await getRemoteTreeWalk(target, worktreePath, {
      signal,
      depth,
      ...(knownWorktrees ? { knownWorktrees } : {}),
    })
  } catch (err) {
    if (signal?.aborted) return { nodes: [], truncated: false }
    // Surface as an empty result so the read layer does not 500.
    void err
    return { nodes: [], truncated: false }
  }
  if (signal?.aborted) return { nodes: [], truncated: false }
  if (!remoteResult.ok) return { nodes: [], truncated: false }

  const rawEntries = parseNullSeparatedPaths(remoteResult.message)
  if (signal?.aborted) return { nodes: [], truncated: false }

  // The remote find returns absolute paths rooted at the worktree
  // path. Strip the worktree prefix so the rest of the source
  // layer can treat them like the local walker output. We also
  // narrow to the requested prefix here -- the remote side cannot
  // express a glob cleanly, so we filter post-hoc. Anything that
  // doesn't fall under `prefix` (or under the worktree root when
  // no prefix is set) is dropped before we even feed buildNodes.
  const root = worktreePath.replace(/\/+$/u, '')
  const prefixWithSep = prefix ? `${prefix}/` : ''
  const entries = rawEntries
    .map((entry) => stripRemoteEntryPrefix(entry, root))
    .filter((entry): entry is string => {
      if (entry === null) return false
      if (prefix === '') return true
      // Allow entries that match exactly the prefix (a directory
      // the walker will need to show as a tree top) and any entry
      // strictly below it.
      return entry === prefix || entry.startsWith(prefixWithSep)
    })

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

function clampDepth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MAX_REPO_TREE_DEPTH
  return Math.min(Math.floor(value), MAX_REPO_TREE_DEPTH)
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  const trimmed = prefix
    .split(path.sep)
    .join('/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
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
 *    - negation (e.g. `!foo`) is silently treated as if the `!`
 *      were absent -- v1 does not implement gitignore re-include
 *      semantics; the spec promises an overlay-dots UI, not the
 *      precise semantics of multi-rule gitignore stacks;
 *    - leading `/` anchors the pattern at the worktree root;
 *    - a bare name (e.g. `node_modules`) becomes a directory-
 *      anchored exclusion that also matches anywhere;
 *    - patterns ending in `/` (directory-only) become
 *      name-with-slashes;
 *    - everything else passes through with a `**` prefix so it
 *      matches anywhere in the tree, matching git default.
 *
 *  v1 does not implement double-star semantics nuances, character
 *  classes, or escaped globs -- these are good follow-ups but the
 *  spec is explicit about a minimal reader. */
function translateGitignoreLine(raw: string): string[] {
  const line = raw.replace(/^\s+|\s+$/g, '')
  if (line === '' || line.startsWith('#')) return []

  // Negation lines (e.g. "!foo") are intentionally a no-op in v1.
  // The spec promises an overlay-dots UI, not the precise semantics
  // of multi-rule gitignore stacks. Drop the leading bang and
  // process the rest as a plain include rule -- this matches what
  // users see in tools like rg's minimal reader.
  let pattern = line.startsWith('!') ? line.slice(1) : line

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
