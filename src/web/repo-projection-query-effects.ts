import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { clearRepoProjectionFetchInvalidationVersion, parseRepoProjectionQueryKey } from '#/web/repo-data-query.ts'

export function useRepoProjectionQueryEffects(queryClient: QueryClient = primaryWindowQueryClient): void {
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'removed') return
      const parsed = parseRepoProjectionQueryKey(event.query.queryKey)
      if (!parsed) return
      clearRepoProjectionFetchInvalidationVersion(
        parsed.repoRoot,
        parsed.workspaceRuntimeId,
        parsed.branch,
        parsed.mode,
        queryClient,
      )
    })
  }, [queryClient])
}
