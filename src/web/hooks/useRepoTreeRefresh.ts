// Read orchestration for the worktree-scoped file tree (docs/filetree.md).
//
// Responsibilities of this hook:
//   1. Own the tree, loading, and error slice for one (repoId,
//      worktreePath) pair.
//   2. Kick the initial fetch on mount and on input change.
//   3. Refetch when an invalidation event with query='repo-snapshot'
//      arrives for the active repoId (the spec chooses snapshot
//      invalidation as the refresh trigger; a dedicated
//      'repo-tree' query kind is intentionally not added in v1).
//   4. Delegate request lifecycle, dedupe, and cancellation to
//      React Query.
//
// Anti-coupling rules (enforced by review):
//   - Do not import useReposStore, terminal hooks, or settings.
//   - Do not publish new event channels; only subscribe.
//   - Do not import server modules or write to the network layer
//     directly -- go through filetree-client.

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRepositoryTree } from '#/web/filetree-client.ts'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'

export interface UseRepoTreeRefreshInput {
  readonly repoId: string
  readonly worktreePath: string
}

export interface UseRepoTreeRefreshResult {
  readonly tree: RepoTreeResult | null
  readonly loading: boolean
  readonly error: string | null
  refresh(): void
}

function repoTreeQueryKey(repoId: string, worktreePath: string) {
  return ['repo-tree', repoId, worktreePath] as const
}

export function useRepoTreeRefresh(input: UseRepoTreeRefreshInput): UseRepoTreeRefreshResult {
  const { repoId, worktreePath } = input
  const queryClient = useQueryClient()
  const enabled = repoId.length > 0 && worktreePath.length > 0
  const queryKey = useMemo(() => repoTreeQueryKey(repoId, worktreePath), [repoId, worktreePath])

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: ({ signal }) => getRepositoryTree(repoId, worktreePath, { signal }),
    retry: false,
  })

  // Refetch when a snapshot invalidation arrives for this repo.
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      if (event.query !== 'repo-snapshot') return
      if (event.repoId !== repoId) return
      void queryClient.invalidateQueries({ queryKey })
    })
  }, [queryClient, queryKey, repoId])

  const { data, error, isPending, refetch } = query

  const refresh = useCallback(() => {
    if (!enabled) return
    void refetch()
  }, [enabled, refetch])

  return {
    tree: data ?? null,
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh,
  }
}
