// Pure transforms for the worktree-scoped file tree source layer
// (docs/filetree.md). Kept in a separate module so the source
// layer's public surface stays narrow (two fetchers + constants)
// while the helpers behind them remain unit-testable in isolation.
//
// Anti-coupling: nothing in this module touches the filesystem,
// SSH, HTTP, or the wire envelope. All functions are pure
// `(input) -> output` transforms over already-fetched strings.

import path from 'node:path'
import type { RepoTreeNode } from '#/shared/api-types.ts'

/** NUL byte used as the record separator for git path streams.
 *  Declared as a constant so the source layer does not have to spell
 *  out the escape inline, which is fragile in some editors. */
export const NULL = String.fromCharCode(0)

export interface BuildNodesInput {
  readonly worktreePath: string
  readonly prefix: string
  readonly depth: number
  readonly entries: ReadonlyArray<string>
}

/** Convert a list of git-owned file entries (relative POSIX paths) into
 *  a flat list of RepoTreeNodes with derived directory nodes. */
export function buildNodes(input: BuildNodesInput): RepoTreeNode[] {
  const { prefix, depth, entries } = input
  const fileNodes: RepoTreeNode[] = []
  const dirIds = new Set<string>()

  for (const rawEntry of entries) {
    const relative = rawEntry.split(path.sep).join('/')
    if (relative === '') continue
    if (prefix && relative !== prefix && !relative.startsWith(`${prefix}/`)) continue
    // Reject anything that escapes the worktree root: top-level
    // `..`, mid-path `..` (e.g. `foo/../../etc/passwd`), and
    // absolute paths. The source layer should only provide relative
    // git paths, but this pure helper is a defense-in-depth boundary
    // for malformed remote output.
    if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) continue
    if (relative.split('/').includes('..')) continue
    if (!isWithinDepth(relative, depth)) continue

    const kind: RepoTreeNode['kind'] = 'file'
    const id = relative
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

  // Sort directories first, then files, both alphabetical.
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

function isWithinDepth(relative: string, depth: number): boolean {
  const segments = relative.split('/').filter(Boolean).length
  return segments <= depth
}

export function parseNullSeparatedPaths(input: string): string[] {
  // Git emits NUL-separated records with no line terminator
  // on the last entry, so the only legitimate "junk" between records is
  // the empty trailing element from the trailing NUL. We deliberately
  // do NOT strip leading/trailing newlines from individual parts -- a
  // path can legitimately contain an embedded newline. Touching the
  // bytes here would silently mangle valid Linux paths.
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
