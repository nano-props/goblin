import { useEffect } from 'react'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { handleRepoInvalidationRefresh } from '#/web/stores/repos/repo-refresh-actions.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { goblinLog } from '#/web/logger.ts'
export function useRepoStoreInvalidationRefresh() {
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      const state = useReposStore.getState()
      const repo = state.repos[event.repoId]
      if (!repo) return
      const workspaceRuntimeId = repo.workspaceRuntimeId
      void handleRepoInvalidationRefresh(
        { get: useReposStore.getState, set: useReposStore.setState },
        event,
        workspaceRuntimeId,
      ).catch((error) => {
        goblinLog.warn('repo invalidation refresh failed', { repoId: event.repoId, query: event.query, error })
      })
    })
  }, [])
}
