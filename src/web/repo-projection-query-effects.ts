import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { parseRepoProjectionQueryKey } from '#/web/repo-data-query.ts'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'

function isRepoRuntimeProjection(value: unknown): value is RepoRuntimeProjection {
  if (!value || typeof value !== 'object') return false
  const projection = value as Partial<RepoRuntimeProjection>
  return (
    typeof projection.loadedAt === 'number' &&
    !!projection.operations &&
    typeof projection.operations === 'object' &&
    !!projection.requested &&
    typeof projection.requested === 'object'
  )
}

export function useRepoProjectionQueryEffects(queryClient: QueryClient = primaryWindowQueryClient): void {
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      if (event.action.type !== 'success') return
      const parsed = parseRepoProjectionQueryKey(event.query.queryKey)
      if (!parsed) return
      const data = event.query.state.data
      if (!isRepoRuntimeProjection(data)) return
      acceptRepoProjectionReadModel(useReposStore.setState, useReposStore.getState, {
        repoRoot: parsed.repoRoot,
        repoRuntimeId: parsed.repoRuntimeId,
        projection: data,
      })
    })
  }, [queryClient])
}
