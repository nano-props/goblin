// Read orchestration for the worktree-scoped lazy file tree (docs/filetree.md).
//
// This hook owns server data only: root/child reads, lazy merge state,
// invalidation, and restored expanded-directory loading. Persisted UI
// interaction state stays in the filetree interaction store.

import { computed, onScopeDispose, reactive, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import type { QueryClient } from '@tanstack/query-core'
import {
  readCurrentWorkspaceFilesystemTree,
  subscribeWorkspaceFilesystemRootReloadStart,
  workspaceFilesystemTreeChildrenQueryKey,
} from '#/web/workspace-filesystem-query.ts'
import {
  emptyLazyWorkspaceFilesystemTreeState,
  lazyWorkspaceFilesystemTreeReducer,
} from '#/web/workspace-filesystem-lazy-state.ts'
import type {
  LazyWorkspaceFilesystemTreeAction,
  LazyWorkspaceFilesystemTreeAggregate,
  LazyWorkspaceFilesystemTreeState,
} from '#/web/workspace-filesystem-lazy-state.ts'
import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import { workspacePaneFilesystemExecutionPath } from '#/shared/workspace-runtime.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

export interface UseWorkspaceFilesystemTreeInput {
  /** Stable for this hook owner's lifetime; execution-target changes replace the owner. */
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly expandedKeys?: MaybeRefOrGetter<readonly string[]>
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
  const target = input.target
  const workspaceId = target.workspaceId
  const workspaceRuntimeId = target.workspaceRuntimeId
  const filesystemRootPath = workspacePaneFilesystemExecutionPath(target)
  const expandedKeys = () => toValue(input.expandedKeys ?? EMPTY_EXPANDED_KEYS)
  const queryClient = useQueryClient()
  const enabled = computed(
    () => workspaceId.length > 0 && workspaceRuntimeId.length > 0 && filesystemRootPath.length > 0,
  )
  const treeState = shallowRef(
    revalidatingCachedWorkspaceFilesystemTreeState({
      queryClient,
      target,
      expandedKeys: expandedKeys(),
    }),
  )

  function dispatchTreeState(action: LazyWorkspaceFilesystemTreeAction): void {
    const next = lazyWorkspaceFilesystemTreeReducer(treeState.value, action)
    if (next !== treeState.value) treeState.value = next
  }

  const rootQuery = useQuery(
    computed(() => ({
      queryKey: workspaceFilesystemTreeChildrenQueryKey(target, ''),
      enabled: enabled.value,
      // The query cache owns this root read across transient panel observer lifetimes.
      queryFn: () => readCurrentWorkspaceFilesystemTree(queryClient, target, {}),
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnMount: 'always' as const,
    })),
  )
  const { data: rootData, error: rootError, isFetching, isPending, refetch } = rootQuery

  const unsubscribeReload = subscribeWorkspaceFilesystemRootReloadStart(queryClient, target, () => {
    dispatchTreeState({ type: 'markForReload' })
  })
  onScopeDispose(unsubscribeReload)

  watch(
    [rootData, isFetching, rootError],
    ([result, fetching, error]) => {
      if (!result || fetching || error) return
      dispatchTreeState({ type: 'childrenLoaded', prefix: '', result })
    },
    { immediate: true },
  )

  async function readChildren(prefix: string): Promise<void> {
    if (!enabled.value) return
    const normalizedPrefix = normalizePrefix(prefix)
    if (treeState.value.loadedPrefixes.has(normalizedPrefix)) return
    if (treeState.value.loadingPrefixes.has(normalizedPrefix)) return

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
    } catch (error) {
      dispatchTreeState({ type: 'childrenFailed', prefix: normalizedPrefix })
      throw error
    } finally {
      dispatchTreeState({ type: 'childrenSettled', prefix: normalizedPrefix })
    }
  }

  const expansionProjection = computed(() =>
    deriveWorkspaceFilesystemExpansionProjection(
      expandedKeys(),
      treeState.value,
      !isFetching.value && Boolean(rootError.value),
    ),
  )

  // Restored expansion state is an external projection. Load only directory
  // prefixes that became reachable in the current authoritative tree.
  watch(
    [rootData, expandedKeys, () => treeState.value.nodesById, () => treeState.value.reloadEpoch],
    ([result]) => {
      if (!result) return
      for (const prefix of expansionProjection.value.restorePrefixes) {
        void readChildren(prefix).catch(() => {})
      }
    },
    { immediate: true },
  )

  function refresh(): void {
    if (!enabled.value) return
    void refetch({ cancelRefetch: false })
  }

  return reactive({
    tree: computed(() => (rootData.value ? treeState.value.result : null)),
    isInitialLoading: computed(() => isPending.value),
    isReading: computed(() => isFetching.value || expansionProjection.value.visibleLoadingPrefixes.size > 0),
    error: computed(() =>
      workspaceFilesystemTreeError(rootError.value, expansionProjection.value.visibleErrorPrefixes),
    ),
    loadingKeys: computed(() => expansionProjection.value.visibleLoadingPrefixes),
    loadedPrefixes: computed(() => treeState.value.loadedPrefixes),
    expandedDirectoryReadsSettled: computed(() => expansionProjection.value.readsSettled),
    loadChildren: readChildren,
    refresh,
  })
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
