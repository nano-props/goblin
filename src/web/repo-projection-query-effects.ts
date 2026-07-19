import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  clearRepoProjectionFetchInvalidationVersion,
  parseRepoProjectionQueryKey,
  setRepoOperationsQueryData,
} from '#/web/repo-data-query.ts'
import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'

export function useRepoProjectionQueryEffects(queryClient: QueryClient = primaryWindowQueryClient): void {
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed') {
        const parsed = parseRepoProjectionQueryKey(event.query.queryKey)
        if (parsed) {
          clearRepoProjectionFetchInvalidationVersion(
            parsed.repoRoot,
            parsed.workspaceRuntimeId,
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
      const data = queryClient.getQueryData<GitWorkspaceRuntimeProjection>(event.query.queryKey)
      if (!data) return
      if (event.action.manual !== true && data.loadedAt > 0) {
        setRepoOperationsQueryData(parsed.repoRoot, parsed.workspaceRuntimeId, false, data.operations, queryClient)
      }
    })
  }, [queryClient])
}
