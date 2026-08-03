// Read orchestration for the worktree-scoped lazy file tree (docs/filetree.md).
//
// This hook owns server data only: root/child reads, lazy merge state,
// invalidation, and restored expanded-directory loading. Persisted UI
// interaction state stays in the filetree interaction store.

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  readCurrentWorkspaceFilesystemTree,
  subscribeWorkspaceFilesystemRootReloadStart,
  workspaceFilesystemTreeChildrenQueryKey,
} from '#/web/workspace-filesystem-query.ts'
import {
  emptyLazyWorkspaceFilesystemTreeState,
  lazyWorkspaceFilesystemTreeReducer,
  type LazyWorkspaceFilesystemTreeAggregate,
  type LazyWorkspaceFilesystemTreeState,
} from '#/web/workspace-filesystem-lazy-state.ts'
import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import {
  workspacePaneFilesystemExecutionPath,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'

export interface UseWorkspaceFilesystemTreeInput {
  /** Stable for this hook owner's lifetime; execution-target changes replace the owner. */
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly expandedKeys?: readonly string[]
}

export interface UseWorkspaceFilesystemTreeResult {
  readonly tree: LazyWorkspaceFilesystemTreeAggregate | null
  readonly isInitialLoading: boolean
  readonly isReading: boolean
  readonly error: string | null
  readonly loadingKeys: ReadonlySet<string>
  readonly loadedPrefixes: ReadonlySet<string>
  readonly expandedDirectoryReadsSettled: boolean
  loadChildren(prefix: string): Promise<void>
  refresh(): void
}

const EMPTY_EXPANDED_KEYS: readonly string[] = []

interface WorkspaceFilesystemExpansionProjection {
  readonly restorePrefixes: ReadonlySet<string>
  readonly visibleLoadingPrefixes: ReadonlySet<string>
  readonly visibleErrorPrefixes: ReadonlySet<string>
  readonly readsSettled: boolean
}

interface CachedWorkspaceFilesystemTreeStateInput {
  readonly queryClient: QueryClient
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly expandedKeys: readonly string[]
}

export function useWorkspaceFilesystemTree(input: UseWorkspaceFilesystemTreeInput): UseWorkspaceFilesystemTreeResult {
  const inputTarget = input.target
  const inputTargetRoot = inputTarget.kind === 'workspace-root' ? inputTarget.workspaceId : inputTarget.root
  const target = useMemo(
    () => inputTarget,
    [inputTarget.kind, inputTarget.workspaceId, inputTarget.workspaceRuntimeId, inputTargetRoot],
  )
  const workspaceId = target.workspaceId
  const workspaceRuntimeId = target.workspaceRuntimeId
  const filesystemRootPath = workspacePaneFilesystemExecutionPath(target)
  const expandedKeys = input.expandedKeys ?? EMPTY_EXPANDED_KEYS
  const queryClient = useQueryClient()
  const enabled = workspaceId.length > 0 && workspaceRuntimeId.length > 0 && filesystemRootPath.length > 0
  const rootQueryKey = useMemo(() => workspaceFilesystemTreeChildrenQueryKey(target, ''), [target])
  const [treeState, dispatchTreeState] = useReducer(
    lazyWorkspaceFilesystemTreeReducer,
    { queryClient, target, expandedKeys },
    revalidatingCachedWorkspaceFilesystemTreeState,
  )

  const rootQuery = useQuery({
    queryKey: rootQueryKey,
    enabled,
    // The query cache owns this root read across transient panel observer lifetimes.
    // Runtime identity is part of the key and the server rejects stale runtimes, so
    // aborting when a tab briefly remounts only creates duplicate replacement reads.
    queryFn: () => readCurrentWorkspaceFilesystemTree(queryClient, target, {}),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: 'always',
    // Keep TanStack's default reconnect revalidation: it converges this read-only
    // projection with server authority and never replays a filesystem operation.
  })
  const { data: rootData, error: rootError, isFetching, isPending, refetch } = rootQuery

  useEffect(() => {
    return subscribeWorkspaceFilesystemRootReloadStart(queryClient, target, () => {
      dispatchTreeState({ type: 'markForReload' })
    })
  }, [queryClient, target])

  useEffect(() => {
    if (!rootData || isFetching || rootError) return
    dispatchTreeState({ type: 'childrenLoaded', prefix: '', result: rootData })
  }, [isFetching, rootData, rootError])

  const readChildren = useCallback(
    async (prefix: string) => {
      if (!enabled) return
      const normalizedPrefix = normalizePrefix(prefix)
      if (treeState.loadedPrefixes.has(normalizedPrefix)) return
      if (treeState.loadingPrefixes.has(normalizedPrefix)) return

      dispatchTreeState({ type: 'childrenLoading', prefix: normalizedPrefix })
      try {
        const result = await queryClient.fetchQuery({
          queryKey: workspaceFilesystemTreeChildrenQueryKey(target, normalizedPrefix),
          queryFn: ({ signal }) =>
            readCurrentWorkspaceFilesystemTree(queryClient, target, {
              prefix: normalizedPrefix || undefined,
              signal,
            }),
          retry: false,
        })
        dispatchTreeState({ type: 'childrenLoaded', prefix: normalizedPrefix, result })
      } catch (err) {
        dispatchTreeState({ type: 'childrenFailed', prefix: normalizedPrefix })
        throw err
      } finally {
        dispatchTreeState({ type: 'childrenSettled', prefix: normalizedPrefix })
      }
    },
    [enabled, queryClient, treeState.loadedPrefixes, treeState.loadingPrefixes, target],
  )

  const loadChildren = useCallback(
    async (prefix: string) => {
      await readChildren(prefix)
    },
    [readChildren],
  )

  const expansionProjection = useMemo(
    () => deriveWorkspaceFilesystemExpansionProjection(expandedKeys, treeState, !isFetching && Boolean(rootError)),
    [expandedKeys, isFetching, rootError, treeState],
  )

  const restoreExpandedChildren = useEffectEvent(() => {
    for (const prefix of expansionProjection.restorePrefixes) {
      void readChildren(prefix).catch(() => {})
    }
  })

  useEffect(() => {
    if (!rootData) return
    restoreExpandedChildren()
  }, [expandedKeys, rootData, treeState.nodesById, treeState.reloadEpoch])

  const refresh = useCallback(() => {
    if (!enabled) return
    void refetch({ cancelRefetch: false })
  }, [enabled, refetch])

  const error = workspaceFilesystemTreeError(rootError, expansionProjection.visibleErrorPrefixes)

  return {
    tree: rootData ? treeState.result : null,
    isInitialLoading: isPending,
    isReading: isFetching || expansionProjection.visibleLoadingPrefixes.size > 0,
    error,
    loadingKeys: expansionProjection.visibleLoadingPrefixes,
    loadedPrefixes: treeState.loadedPrefixes,
    expandedDirectoryReadsSettled: expansionProjection.readsSettled,
    loadChildren,
    refresh,
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\.\/+/, '').replace(/\/+$/u, '')
}

function deriveWorkspaceFilesystemExpansionProjection(
  expandedKeys: readonly string[],
  state: LazyWorkspaceFilesystemTreeState,
  rootReadFailed: boolean,
): WorkspaceFilesystemExpansionProjection {
  const expandedPrefixes = new Set(expandedKeys.map(normalizePrefix).filter(Boolean))
  const reachablePrefixes = new Set<string>()
  const restorePrefixes = new Set<string>()
  const visibleLoadingPrefixes = new Set<string>()
  const visibleErrorPrefixes = new Set<string>()
  let readsSettled = true

  for (const prefix of expandedPrefixes) {
    if (!hasExpandedAncestors(prefix, expandedPrefixes)) continue
    reachablePrefixes.add(prefix)
  }

  for (const prefix of reachablePrefixes) {
    if (state.loadingPrefixes.has(prefix)) visibleLoadingPrefixes.add(prefix)
    if (state.errorPrefixes.has(prefix)) visibleErrorPrefixes.add(prefix)

    const blockedByAncestorError = hasAncestorInSet(prefix, state.errorPrefixes)
    const node = state.nodesById.get(prefix)
    if (
      node?.kind === 'directory' &&
      !state.loadedPrefixes.has(prefix) &&
      !state.loadingPrefixes.has(prefix) &&
      !state.errorPrefixes.has(prefix) &&
      !blockedByAncestorError
    ) {
      restorePrefixes.add(prefix)
    }

    if (state.loadingPrefixes.has(prefix)) {
      readsSettled = false
      continue
    }
    if (state.loadedPrefixes.has(prefix) || state.errorPrefixes.has(prefix) || blockedByAncestorError) continue
    if (rootReadFailed && node?.kind !== 'directory') continue
    if (state.loadedPrefixes.has(parentPrefix(prefix)) && node?.kind !== 'directory') continue
    readsSettled = false
  }

  return { restorePrefixes, visibleLoadingPrefixes, visibleErrorPrefixes, readsSettled }
}

function hasExpandedAncestors(prefix: string, expandedPrefixes: ReadonlySet<string>): boolean {
  let slash = prefix.lastIndexOf('/')
  while (slash >= 0) {
    const ancestor = prefix.slice(0, slash)
    if (!expandedPrefixes.has(ancestor)) return false
    slash = ancestor.lastIndexOf('/')
  }
  return true
}

function hasAncestorInSet(prefix: string, prefixes: ReadonlySet<string>): boolean {
  let slash = prefix.lastIndexOf('/')
  while (slash >= 0) {
    const ancestor = prefix.slice(0, slash)
    if (prefixes.has(ancestor)) return true
    slash = ancestor.lastIndexOf('/')
  }
  return false
}

function parentPrefix(prefix: string): string {
  const slash = prefix.lastIndexOf('/')
  return slash < 0 ? '' : prefix.slice(0, slash)
}

function cachedWorkspaceFilesystemTreeState({
  queryClient,
  target,
  expandedKeys,
}: CachedWorkspaceFilesystemTreeStateInput): LazyWorkspaceFilesystemTreeState {
  let state = emptyLazyWorkspaceFilesystemTreeState()
  for (const prefix of cachedPrefixesForExpandedKeys(expandedKeys)) {
    const result = queryClient.getQueryData<WorkspaceFilesystemTreeResult>(
      workspaceFilesystemTreeChildrenQueryKey(target, prefix),
    )
    if (!result) continue
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenLoaded', prefix, result })
  }
  return state
}

function revalidatingCachedWorkspaceFilesystemTreeState(
  input: CachedWorkspaceFilesystemTreeStateInput,
): LazyWorkspaceFilesystemTreeState {
  return lazyWorkspaceFilesystemTreeReducer(cachedWorkspaceFilesystemTreeState(input), { type: 'markForReload' })
}

function workspaceFilesystemTreeError(rootError: unknown, errorPrefixes: ReadonlySet<string>): string | null {
  if (rootError instanceof Error) return rootError.message
  if (rootError) return String(rootError)
  if (errorPrefixes.size > 0) return 'filetree.error'
  return null
}

function cachedPrefixesForExpandedKeys(expandedKeys: readonly string[]): readonly string[] {
  const prefixes = new Set<string>([''])
  for (const key of expandedKeys) {
    const normalizedKey = normalizePrefix(key)
    if (!normalizedKey) continue
    for (const prefix of ancestorAndSelfPrefixes(normalizedKey)) prefixes.add(prefix)
  }
  return Array.from(prefixes).sort((a, b) => prefixDepth(a) - prefixDepth(b) || a.localeCompare(b))
}

function ancestorAndSelfPrefixes(key: string): readonly string[] {
  const parts = key.split('/').filter(Boolean)
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
}

function prefixDepth(prefix: string): number {
  return prefix === '' ? 0 : prefix.split('/').length
}
