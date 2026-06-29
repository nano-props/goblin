import type { RepoTreeNode, RepoTreeResult } from '#/shared/api-types.ts'

export interface LazyRepoTreeAggregate {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  readonly truncated: boolean
}

export interface LazyRepoTreeState {
  readonly nodesById: ReadonlyMap<string, RepoTreeNode>
  readonly childIdsByParentId: ReadonlyMap<string | null, readonly string[]>
  readonly truncatedPrefixes: ReadonlySet<string>
  readonly loadedPrefixes: ReadonlySet<string>
  readonly loadingPrefixes: ReadonlySet<string>
  readonly errorPrefixes: ReadonlySet<string>
  readonly reloadEpoch: number
  readonly result: LazyRepoTreeAggregate
}

export type LazyRepoTreeAction =
  | { readonly type: 'replace'; readonly state: LazyRepoTreeState }
  | { readonly type: 'markForReload' }
  | { readonly type: 'childrenLoading'; readonly prefix: string }
  | { readonly type: 'childrenLoaded'; readonly prefix: string; readonly result: RepoTreeResult }
  | { readonly type: 'childrenFailed'; readonly prefix: string }
  | { readonly type: 'childrenSettled'; readonly prefix: string }

export function emptyLazyRepoTreeState(): LazyRepoTreeState {
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

export function lazyRepoTreeReducer(state: LazyRepoTreeState, action: LazyRepoTreeAction): LazyRepoTreeState {
  switch (action.type) {
    case 'replace':
      return action.state
    case 'markForReload':
      return {
        ...state,
        loadedPrefixes: new Set(),
        loadingPrefixes: new Set(),
        errorPrefixes: new Set(),
        reloadEpoch: state.reloadEpoch + 1,
      }
    case 'childrenLoading': {
      const errorPrefixes = new Set(state.errorPrefixes)
      errorPrefixes.delete(action.prefix)
      return { ...state, loadingPrefixes: new Set(state.loadingPrefixes).add(action.prefix), errorPrefixes }
    }
    case 'childrenLoaded':
      return mergeChildren(state, action.prefix, action.result)
    case 'childrenFailed':
      return { ...state, errorPrefixes: new Set(state.errorPrefixes).add(action.prefix) }
    case 'childrenSettled': {
      const loadingPrefixes = new Set(state.loadingPrefixes)
      loadingPrefixes.delete(action.prefix)
      return { ...state, loadingPrefixes }
    }
  }
  const exhaustive: never = action
  return exhaustive
}

function mergeChildren(current: LazyRepoTreeState, prefix: string, result: RepoTreeResult): LazyRepoTreeState {
  const parentId = prefix || null
  const nodesById = new Map(current.nodesById)
  const childIdsByParentId = new Map(current.childIdsByParentId)
  const previousChildIds = childIdsByParentId.get(parentId) ?? []
  for (const id of previousChildIds) {
    if (!result.nodes.some((node) => node.id === id)) removeSubtree(id, nodesById, childIdsByParentId)
  }

  const childIds = result.nodes.map((node) => node.id)
  for (const node of result.nodes) nodesById.set(node.id, node)
  childIdsByParentId.set(parentId, childIds)

  const truncatedPrefixes = new Set(current.truncatedPrefixes)
  if (result.truncated) truncatedPrefixes.add(prefix)
  else truncatedPrefixes.delete(prefix)

  return {
    nodesById,
    childIdsByParentId,
    truncatedPrefixes,
    loadedPrefixes: new Set(current.loadedPrefixes).add(prefix),
    loadingPrefixes: current.loadingPrefixes,
    errorPrefixes: withoutPrefix(current.errorPrefixes, prefix),
    reloadEpoch: current.reloadEpoch,
    result: {
      nodes: Array.from(nodesById.values()),
      truncated: truncatedPrefixes.size > 0,
    },
  }
}

function removeSubtree(
  id: string,
  nodesById: Map<string, RepoTreeNode>,
  childIdsByParentId: Map<string | null, readonly string[]>,
): void {
  const childIds = childIdsByParentId.get(id) ?? []
  for (const childId of childIds) removeSubtree(childId, nodesById, childIdsByParentId)
  nodesById.delete(id)
  childIdsByParentId.delete(id)
}

function withoutPrefix(prefixes: ReadonlySet<string>, prefix: string): ReadonlySet<string> {
  if (!prefixes.has(prefix)) return prefixes
  const next = new Set(prefixes)
  next.delete(prefix)
  return next
}
