// Read orchestration for the worktree-scoped lazy file tree (docs/filetree.md).
//
// This hook owns server data only: root/child reads, lazy merge state,
// invalidation, and restored expanded-directory loading. Persisted UI
// interaction state stays in the filetree interaction store.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getRepositoryTree } from '#/web/filetree-client.ts'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import {
  emptyLazyRepoTreeState,
  lazyRepoTreeReducer,
  type LazyRepoTreeAggregate,
  type LazyRepoTreeState,
} from '#/web/filetree-lazy-state.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'

export interface UseLazyRepoTreeInput {
  readonly repoId: string
  readonly repoRuntimeId: string
  readonly worktreePath: string
  readonly expandedKeys?: readonly string[]
}

export interface UseLazyRepoTreeResult {
  readonly tree: LazyRepoTreeAggregate | null
  readonly loading: boolean
  readonly error: string | null
  readonly loadingKeys: ReadonlySet<string>
  readonly errorKeys: ReadonlySet<string>
  readonly loadedPrefixes: ReadonlySet<string>
  loadChildren(prefix: string): Promise<void>
  refresh(): void
}

type ChildLoadMode = 'manual' | 'restore'

const EMPTY_EXPANDED_KEYS: readonly string[] = []

interface CachedLazyRepoTreeStateInput {
  readonly queryClient: QueryClient
  readonly repoId: string
  readonly repoRuntimeId: string
  readonly worktreePath: string
  readonly expandedKeys: readonly string[]
}

function repoTreeChildrenQueryKey(repoId: string, repoRuntimeId: string, worktreePath: string, prefix: string) {
  return ['repo-tree-children', repoId, repoRuntimeId, worktreePath, prefix] as const
}

export function useLazyRepoTree(input: UseLazyRepoTreeInput): UseLazyRepoTreeResult {
  const { repoId, repoRuntimeId, worktreePath } = input
  const expandedKeys = input.expandedKeys ?? EMPTY_EXPANDED_KEYS
  const queryClient = useQueryClient()
  const enabled = repoId.length > 0 && repoRuntimeId.length > 0 && worktreePath.length > 0
  const rootQueryKey = useMemo(
    () => repoTreeChildrenQueryKey(repoId, repoRuntimeId, worktreePath, ''),
    [repoId, repoRuntimeId, worktreePath],
  )
  const expandedKeysCacheSignal = useMemo(() => expandedKeys.map(normalizePrefix).join('\0'), [expandedKeys])
  const cachedExpandedPrefixes = useMemo(() => cachedPrefixesForExpandedKeys(expandedKeys), [expandedKeysCacheSignal])
  const [treeState, dispatchTreeState] = useReducer(
    lazyRepoTreeReducer,
    { queryClient, repoId, repoRuntimeId, worktreePath, expandedKeys },
    cachedLazyRepoTreeState,
  )
  const expandedKeysRef = useRef(expandedKeys)
  const readChildrenRef = useRef<(prefix: string, mode: ChildLoadMode) => Promise<void>>(async () => {})

  const rootQuery = useQuery({
    queryKey: rootQueryKey,
    enabled,
    queryFn: ({ signal }) => getRepositoryTree(repoId, worktreePath, { repoRuntimeId, signal }),
    retry: false,
  })
  const { data: rootData, error: rootError, isPending, refetch } = rootQuery

  useEffect(() => {
    expandedKeysRef.current = expandedKeys
  }, [expandedKeysCacheSignal, expandedKeys])

  useEffect(() => {
    dispatchTreeState({
      type: 'replace',
      state: cachedLazyRepoTreeState({
        queryClient,
        repoId,
        repoRuntimeId,
        worktreePath,
        expandedKeys: expandedKeysRef.current,
      }),
    })
  }, [queryClient, repoId, repoRuntimeId, worktreePath])

  useEffect(() => {
    if (!enabled) return
    for (const prefix of cachedExpandedPrefixes) {
      const result = queryClient.getQueryData<RepoTreeResult>(
        repoTreeChildrenQueryKey(repoId, repoRuntimeId, worktreePath, prefix),
      )
      if (!result) continue
      dispatchTreeState({ type: 'childrenLoaded', prefix, result })
    }
  }, [cachedExpandedPrefixes, enabled, queryClient, repoId, repoRuntimeId, worktreePath])

  useEffect(() => {
    if (!rootData) return
    dispatchTreeState({ type: 'childrenLoaded', prefix: '', result: rootData })
  }, [rootData])

  const readChildren = useCallback(
    async (prefix: string, mode: ChildLoadMode) => {
      if (!enabled) return
      const normalizedPrefix = normalizePrefix(prefix)
      if (treeState.loadedPrefixes.has(normalizedPrefix)) return
      if (treeState.loadingPrefixes.has(normalizedPrefix)) return
      if (mode === 'restore' && treeState.errorPrefixes.has(normalizedPrefix)) return

      dispatchTreeState({ type: 'childrenLoading', prefix: normalizedPrefix })
      try {
        const result = await queryClient.fetchQuery({
          queryKey: repoTreeChildrenQueryKey(repoId, repoRuntimeId, worktreePath, normalizedPrefix),
          queryFn: ({ signal }) =>
            getRepositoryTree(repoId, worktreePath, { repoRuntimeId, prefix: normalizedPrefix || undefined, signal }),
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
    [
      enabled,
      queryClient,
      repoId,
      repoRuntimeId,
      treeState.errorPrefixes,
      treeState.loadedPrefixes,
      treeState.loadingPrefixes,
      worktreePath,
    ],
  )

  const loadChildren = useCallback(
    async (prefix: string) => {
      await readChildren(prefix, 'manual')
    },
    [readChildren],
  )

  useEffect(() => {
    readChildrenRef.current = readChildren
  }, [readChildren])

  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      if (event.query !== 'repo-snapshot') return
      if (event.repoId !== repoId) return
      dispatchTreeState({ type: 'markForReload' })
      void queryClient.invalidateQueries({ queryKey: ['repo-tree-children', repoId, repoRuntimeId, worktreePath] })
    })
  }, [queryClient, repoId, repoRuntimeId, worktreePath])

  useEffect(() => {
    if (!rootData) return
    for (const key of expandedKeys) void readChildrenRef.current(key, 'restore').catch(() => {})
  }, [expandedKeysCacheSignal, rootData, treeState.reloadEpoch])

  const refresh = useCallback(() => {
    if (!enabled) return
    dispatchTreeState({ type: 'markForReload' })
    void refetch()
  }, [enabled, refetch])

  return {
    tree: rootData ? treeState.result : null,
    loading: isPending,
    error: rootError instanceof Error ? rootError.message : rootError ? String(rootError) : null,
    loadingKeys: treeState.loadingPrefixes,
    errorKeys: treeState.errorPrefixes,
    loadedPrefixes: treeState.loadedPrefixes,
    loadChildren,
    refresh,
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\.\/+/, '').replace(/\/+$/u, '')
}

function cachedLazyRepoTreeState({
  queryClient,
  repoId,
  repoRuntimeId,
  worktreePath,
  expandedKeys,
}: CachedLazyRepoTreeStateInput): LazyRepoTreeState {
  if (!repoId || !worktreePath) return emptyLazyRepoTreeState()
  let state = emptyLazyRepoTreeState()
  for (const prefix of cachedPrefixesForExpandedKeys(expandedKeys)) {
    const result = queryClient.getQueryData<RepoTreeResult>(
      repoTreeChildrenQueryKey(repoId, repoRuntimeId, worktreePath, prefix),
    )
    if (!result) continue
    state = lazyRepoTreeReducer(state, { type: 'childrenLoaded', prefix, result })
  }
  return state
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
