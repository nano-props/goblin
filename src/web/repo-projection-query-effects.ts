import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  clearRepoProjectionFetchInvalidationVersion,
  parseRepoProjectionQueryKey,
  setRepoOperationsQueryData,
} from '#/web/repo-data-query.ts'
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
      if (event.type === 'removed') {
        const parsed = parseRepoProjectionQueryKey(event.query.queryKey)
        if (parsed) {
          clearRepoProjectionFetchInvalidationVersion(
            parsed.repoRoot,
            parsed.repoRuntimeId,
            parsed.branch,
            parsed.mode,
            queryClient,
          )
        }
        return
      }
      if (event.type !== 'updated') return
      const parsed = parseRepoProjectionQueryKey(event.query.queryKey)
      if (!parsed) return
      if (event.action.type !== 'success') return
      const data = event.query.state.data
      if (!isRepoRuntimeProjection(data)) return
      if (event.action.manual !== true && data.loadedAt > 0) {
        setRepoOperationsQueryData(parsed.repoRoot, parsed.repoRuntimeId, false, data.operations, queryClient)
      }
    })
  }, [queryClient])
}
