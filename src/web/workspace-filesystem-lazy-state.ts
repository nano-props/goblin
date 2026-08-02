import type { WorkspaceFilesystemNode, WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'

export interface LazyWorkspaceFilesystemTreeAggregate {
  readonly nodes: ReadonlyArray<WorkspaceFilesystemNode>
  readonly truncated: boolean
}

export interface LazyWorkspaceFilesystemTreeState {
  readonly nodesById: ReadonlyMap<string, WorkspaceFilesystemNode>
  readonly childIdsByParentId: ReadonlyMap<string | null, readonly string[]>
  readonly truncatedPrefixes: ReadonlySet<string>
  readonly loadedPrefixes: ReadonlySet<string>
  readonly loadingPrefixes: ReadonlySet<string>
  readonly errorPrefixes: ReadonlySet<string>
  readonly reloadEpoch: number
  readonly result: LazyWorkspaceFilesystemTreeAggregate
}

export type LazyWorkspaceFilesystemTreeAction =
  | { readonly type: 'markForReload' }
  | { readonly type: 'childrenLoading'; readonly prefix: string }
  | { readonly type: 'childrenLoaded'; readonly prefix: string; readonly result: WorkspaceFilesystemTreeResult }
  | { readonly type: 'childrenFailed'; readonly prefix: string }
  | { readonly type: 'childrenSettled'; readonly prefix: string }

export function emptyLazyWorkspaceFilesystemTreeState(): LazyWorkspaceFilesystemTreeState {
  return {
    nodesById: new Map(),
    childIdsByParentId: new Map(),
    truncatedPrefixes: new Set(),
    loadedPrefixes: new Set(),
    loadingPrefixes: new Set(),
    errorPrefixes: new Set(),
    reloadEpoch: 0,
    result: { nodes: [], truncated: false },
  }
}

export function lazyWorkspaceFilesystemTreeReducer(
  state: LazyWorkspaceFilesystemTreeState,
  action: LazyWorkspaceFilesystemTreeAction,
): LazyWorkspaceFilesystemTreeState {
  switch (action.type) {
    case 'markForReload':
      return {
        ...state,
        loadedPrefixes: new Set(),
        loadingPrefixes: new Set(),
        errorPrefixes: new Set(),
        reloadEpoch: state.reloadEpoch + 1,
      }
    case 'childrenLoading': {
      if (!isCurrentDirectoryPrefix(state, action.prefix)) return state
      const errorPrefixes = new Set(state.errorPrefixes)
      errorPrefixes.delete(action.prefix)
      return { ...state, loadingPrefixes: new Set(state.loadingPrefixes).add(action.prefix), errorPrefixes }
    }
    case 'childrenLoaded':
      if (!isCurrentDirectoryPrefix(state, action.prefix)) return state
      return mergeChildren(state, action.prefix, action.result)
    case 'childrenFailed':
      if (!isCurrentDirectoryPrefix(state, action.prefix)) return state
      return { ...state, errorPrefixes: new Set(state.errorPrefixes).add(action.prefix) }
    case 'childrenSettled': {
      if (!isCurrentDirectoryPrefix(state, action.prefix)) return state
      const loadingPrefixes = new Set(state.loadingPrefixes)
      loadingPrefixes.delete(action.prefix)
      return { ...state, loadingPrefixes }
    }
  }
  const exhaustive: never = action
  return exhaustive
}

function mergeChildren(
  current: LazyWorkspaceFilesystemTreeState,
  prefix: string,
  result: WorkspaceFilesystemTreeResult,
): LazyWorkspaceFilesystemTreeState {
  const parentId = prefix || null
  const nodesById = new Map(current.nodesById)
  const childIdsByParentId = new Map(current.childIdsByParentId)
  const previousChildIds = childIdsByParentId.get(parentId) ?? []
  const nextNodesById = new Map(result.nodes.map((node) => [node.id, node]))
  for (const id of previousChildIds) {
    const previousNode = nodesById.get(id)
    const nextNode = nextNodesById.get(id)
    if (!nextNode || (previousNode?.kind === 'directory' && nextNode.kind !== 'directory')) {
      removeSubtree(id, nodesById, childIdsByParentId)
    }
  }

  const childIds = result.nodes.map((node) => node.id)
  for (const node of result.nodes) nodesById.set(node.id, node)
  childIdsByParentId.set(parentId, childIds)

  const nextTruncatedPrefixes = new Set(current.truncatedPrefixes)
  if (result.truncated) nextTruncatedPrefixes.add(prefix)
  else nextTruncatedPrefixes.delete(prefix)

  const truncatedPrefixes = existingDirectoryPrefixes(nextTruncatedPrefixes, nodesById)
  const loadedPrefixes = existingDirectoryPrefixes(new Set(current.loadedPrefixes).add(prefix), nodesById)
  const loadingPrefixes = existingDirectoryPrefixes(current.loadingPrefixes, nodesById)
  const errorPrefixes = existingDirectoryPrefixes(withoutPrefix(current.errorPrefixes, prefix), nodesById)

  return {
    nodesById,
    childIdsByParentId,
    truncatedPrefixes,
    loadedPrefixes,
    loadingPrefixes,
    errorPrefixes,
    reloadEpoch: current.reloadEpoch,
    result: {
      nodes: Array.from(nodesById.values()),
      truncated: truncatedPrefixes.size > 0,
    },
  }
}

function removeSubtree(
  id: string,
  nodesById: Map<string, WorkspaceFilesystemNode>,
  childIdsByParentId: Map<string | null, readonly string[]>,
): void {
  const childIds = childIdsByParentId.get(id) ?? []
  for (const childId of childIds) removeSubtree(childId, nodesById, childIdsByParentId)
  nodesById.delete(id)
  childIdsByParentId.delete(id)
}

function isCurrentDirectoryPrefix(state: LazyWorkspaceFilesystemTreeState, prefix: string): boolean {
  return prefix === '' || state.nodesById.get(prefix)?.kind === 'directory'
}

function existingDirectoryPrefixes(
  prefixes: ReadonlySet<string>,
  nodesById: ReadonlyMap<string, WorkspaceFilesystemNode>,
): ReadonlySet<string> {
  return new Set(Array.from(prefixes).filter((prefix) => prefix === '' || nodesById.get(prefix)?.kind === 'directory'))
}

function withoutPrefix(prefixes: ReadonlySet<string>, prefix: string): ReadonlySet<string> {
  if (!prefixes.has(prefix)) return prefixes
  const next = new Set(prefixes)
  next.delete(prefix)
  return next
}
