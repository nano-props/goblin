import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { parseRepoProjectionQueryKey } from '#/web/repo-query-keys.ts'
import { clearRepoProjectionFetchInvalidationVersion } from '#/web/repo-query-runtime.ts'

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
