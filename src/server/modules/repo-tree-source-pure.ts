// Pure transforms for the worktree-scoped file tree source layer
// (docs/filetree.md). Kept in a separate module so the source
// layer's public surface stays narrow (two fetchers + constants)
// while the helpers behind them remain unit-testable in isolation.
//
// Anti-coupling: nothing in this module touches the filesystem,
// SSH, HTTP, or the wire envelope. All functions are pure
// `(input) -> output` transforms over already-fetched strings.

import path from 'node:path'
import type { RepoTreeNode, RepoTreeNodeStatus } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

/** NUL byte used as the record separator for `find -print0` output
 *  from the remote side. Declared as a constant so the source
 *  layer does not have to spell out the escape inline (which is
 *  fragile in some editors). */
export const NULL = String.fromCharCode(0)

export interface BuildNodesInput {
  readonly worktreePath: string
  readonly prefix: string
  readonly depth: number
  readonly entries: ReadonlyArray<string>
}

/** Convert a list of tinyglobby entries (relative POSIX paths) into
 *  a flat list of RepoTreeNodes with derived directory nodes. */
export function buildNodes(input: BuildNodesInput): RepoTreeNode[] {
  const { prefix, depth, entries } = input
  const fileNodes: RepoTreeNode[] = []
  const dirIds = new Set<string>()

  for (const rawEntry of entries) {
    const relative = rawEntry.split(path.sep).join('/')
    // Reject anything that escapes the worktree root: top-level
    // `..`, mid-path `..` (e.g. `foo/../../etc/passwd`), and
    // absolute paths. The local walker never produces these --
    // tinyglobby's `cwd` is the worktree root and it refuses to
    // ascend -- but the remote side hands us whatever `find
    // -print0` returned, and `find` will follow symlinks into a
    // symlinked ancestor without complaint.
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) continue
    if (relative.split('/').includes('..')) continue
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

  const visibleFileNodes = fileNodes.filter((node) => !dirIds.has(node.id))

  // Sort directories first, then files, both alphabetical. Children
  // of the same parent appear next to each other because we already
  // walk in tree order via tinyglobby.
  return [...dirNodes, ...visibleFileNodes].sort(compareNodes)
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

export function parseNullSeparatedPaths(input: string): string[] {
  // `find -print0` emits NUL-separated records with no line terminator
  // on the last entry, so the only legitimate "junk" between records is
  // the empty trailing element from the trailing NUL. We deliberately
  // do NOT strip leading/trailing newlines from individual parts -- a
  // path can legitimately contain an embedded newline when git status -z
  // quotes it, and `find -print0` would still hand us the line-boundary
  // inside that quoted segment. Touching the bytes here would silently
  // mangle valid Linux paths. See parsers.test.ts: 'handles paths with
  // embedded newlines (quoted paths in git status -z)'.
  if (input.length === 0) return []
  return input.split(NULL).filter((part) => part.length > 0)
}

export function stripRemoteEntryPrefix(entry: string, root: string): string | null {
  if (entry === root) return ''
  if (entry.startsWith(`${root}/`)) {
    const relative = entry.slice(root.length + 1)
    if (relative.startsWith('../') || relative === '..' || relative.includes(NULL)) return null
    return relative
  }
  return null
}
