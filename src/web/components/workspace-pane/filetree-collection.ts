import { type Key } from 'react-aria-components'
import type { WorkspaceFilesystemNode } from '#/shared/api-types.ts'
import type { LazyWorkspaceFilesystemTreeAggregate } from '#/web/workspace-filesystem-lazy-state.ts'

export interface FiletreeRow {
  readonly id: string
  readonly node: WorkspaceFilesystemNode
  readonly level: number
  readonly posInSet: number
  readonly setSize: number
}

export interface FiletreeCollection {
  readonly rows: ReadonlyArray<FiletreeRow>
  readonly byId: ReadonlyMap<string, WorkspaceFilesystemNode>
  readonly childIdsByParentId: ReadonlyMap<string | null, readonly string[]>
}

export function buildFiletreeCollection(
  result: LazyWorkspaceFilesystemTreeAggregate | null,
  expandedKeys: ReadonlySet<Key>,
): FiletreeCollection {
  const byId = new Map<string, WorkspaceFilesystemNode>()
  const childrenByParent = new Map<string | null, WorkspaceFilesystemNode[]>()
  if (!result) return { rows: [], byId, childIdsByParentId: new Map() }

  for (const node of result.nodes) {
    byId.set(node.id, node)
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node)
    childrenByParent.set(node.parentId, list)
  }
  for (const list of childrenByParent.values()) list.sort(compareNodesForRender)

  const rows: FiletreeRow[] = []
  const visiting = new Set<string>()
  const pushRows = (parentId: string | null, level: number) => {
    const siblings = childrenByParent.get(parentId) ?? []
    const setSize = siblings.length
    for (const [index, node] of siblings.entries()) {
      if (visiting.has(node.id)) continue
      rows.push({ id: node.id, node, level, posInSet: index + 1, setSize })
      if (node.kind !== 'directory' || !expandedKeys.has(node.id)) continue
      visiting.add(node.id)
      pushRows(node.id, level + 1)
      visiting.delete(node.id)
    }
  }
  pushRows(null, 1)

  const childIdsByParentId = new Map<string | null, readonly string[]>()
  for (const [parentId, nodes] of childrenByParent)
    childIdsByParentId.set(
      parentId,
      nodes.map((node) => node.id),
    )
  return { rows, byId, childIdsByParentId }
}

function compareNodesForRender(a: WorkspaceFilesystemNode, b: WorkspaceFilesystemNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}
