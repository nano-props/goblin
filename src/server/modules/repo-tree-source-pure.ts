// Pure transforms for the worktree-scoped file tree source layer
// (docs/filetree.md). Kept in a separate module so the source
// layer's public surface stays narrow while the helpers behind it
// remain unit-testable in isolation.

import path from 'node:path'
import type { RepoTreeNode } from '#/shared/api-types.ts'

/** NUL byte used as the record separator for git path streams. */
export const NULL = String.fromCharCode(0)

export interface BuildChildNodesInput {
  readonly prefix: string
  readonly entries: ReadonlyArray<string>
}

/** Build only the direct children of `prefix`. Directory entries are
 *  represented by a trailing slash in the input and are marked as
 *  expandable without recursively reading their descendants. */
export function buildChildNodes(input: BuildChildNodesInput): RepoTreeNode[] {
  const prefix = normalizeTreePrefix(input.prefix)
  const byId = new Map<string, RepoTreeNode>()

  for (const rawEntry of input.entries) {
    const relative = sanitizeRelativeEntry(rawEntry)
    if (relative === null) continue
    const child = directChildForPrefix(relative, prefix)
    if (!child) continue
    byId.set(child.id, child)
  }

  return Array.from(byId.values()).sort(compareNodes)
}

function directChildForPrefix(relative: string, prefix: string): RepoTreeNode | null {
  if (prefix && relative !== prefix && !relative.startsWith(`${prefix}/`)) return null
  if (relative === prefix) return null

  const remainder = prefix ? relative.slice(prefix.length + 1) : relative
  if (!remainder) return null

  const isDirectory = remainder.endsWith('/')
  const name = isDirectory ? remainder.slice(0, -1) : remainder
  if (!name || name.includes('/')) return null

  const id = prefix ? `${prefix}/${name}` : name
  return {
    id,
    path: id,
    name,
    parentId: prefix || null,
    kind: isDirectory ? 'directory' : 'file',
    status: 'clean',
    ...(isDirectory ? { hasChildren: true } : {}),
  }
}

function compareNodes(a: RepoTreeNode, b: RepoTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function sanitizeRelativeEntry(rawEntry: string): string | null {
  const relative = rawEntry.split(path.sep).join('/').replace(/\/+$/u, (match) => (match.length > 0 ? '/' : ''))
  if (relative === '') return null
  if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) return null
  if (relative.split('/').includes('..')) return null
  return relative
}

function normalizeTreePrefix(prefix: string): string {
  return prefix.replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function parseNullSeparatedPaths(input: string): string[] {
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
