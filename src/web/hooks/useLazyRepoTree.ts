// Read orchestration for the worktree-scoped lazy file tree (docs/filetree.md).
//
// This hook owns server data only: root/child reads, lazy merge state,
// invalidation, and restored expanded-directory loading. Persisted UI
// interaction state stays in the filetree interaction store.

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRepositoryTree } from '#/web/filetree-client.ts'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { emptyLazyRepoTreeState, lazyRepoTreeReducer } from '#/web/filetree-lazy-state.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'

export interface UseLazyRepoTreeInput {
  readonly repoId: string
  readonly worktreePath: string
  readonly expandedKeys?: readonly string[]
}

export interface UseLazyRepoTreeResult {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  readonly loadingKeys: ReadonlySet<string>
  readonly errorKeys: ReadonlySet<string>
  readonly loadedPrefixes: ReadonlySet<string>
  loadChildren(prefix: string): Promise<void>
  refresh(): void
}

type ChildLoadMode = 'manual' | 'restore'

function repoTreeChildrenQueryKey(repoId: string, worktreePath: string, prefix: string) {
  return ['repo-tree-children', repoId, worktreePath, prefix] as const
}

export function useLazyRepoTree(input: UseLazyRepoTreeInput): UseLazyRepoTreeResult {
  const { repoId, worktreePath, expandedKeys = [] } = input
  const queryClient = useQueryClient()
  const enabled = repoId.length > 0 && worktreePath.length > 0
  const rootQueryKey = useMemo(() => repoTreeChildrenQueryKey(repoId, worktreePath, ''), [repoId, worktreePath])
  const [treeState, dispatchTreeState] = useReducer(lazyRepoTreeReducer, undefined, emptyLazyRepoTreeState)

  const rootQuery = useQuery({
    queryKey: rootQueryKey,
    enabled,
    queryFn: ({ signal }) => getRepositoryTree(repoId, worktreePath, { signal }),
    retry: false,
  })
  const { data: rootData, error: rootError, isPending, refetch } = rootQuery

  useEffect(() => {
    dispatchTreeState({ type: 'reset' })
  }, [repoId, worktreePath])

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
          queryKey: repoTreeChildrenQueryKey(repoId, worktreePath, normalizedPrefix),
          queryFn: ({ signal }) =>
            getRepositoryTree(repoId, worktreePath, { prefix: normalizedPrefix || undefined, signal }),
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
    return subscribeRepoQueryInvalidation((event) => {
      if (event.query !== 'repo-snapshot') return
      if (event.repoId !== repoId) return
      dispatchTreeState({ type: 'markForReload' })
      void queryClient.invalidateQueries({ queryKey: ['repo-tree-children', repoId, worktreePath] })
    })
  }, [queryClient, repoId, worktreePath])

  useEffect(() => {
    if (!rootData) return
    for (const key of expandedKeys) void readChildren(key, 'restore').catch(() => {})
  }, [expandedKeys, readChildren, rootData, treeState.reloadEpoch])

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
