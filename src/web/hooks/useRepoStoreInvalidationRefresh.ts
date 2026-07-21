import { useEffect } from 'react'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { handleRepoInvalidationRefresh } from '#/web/stores/workspaces/repo-refresh-actions.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { goblinLog } from '#/web/logger.ts'
export function useRepoStoreInvalidationRefresh() {
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      const state = useWorkspacesStore.getState()
      const repo = state.workspaces[event.repoId]
      if (!repo) return
      const workspaceRuntimeId = repo.workspaceRuntimeId
      void handleRepoInvalidationRefresh(
        { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
        event,
        workspaceRuntimeId,
      ).catch((error) => {
        goblinLog.warn('repo invalidation refresh failed', { repoId: event.repoId, query: event.query, error })
      })
    })
  }, [])
}
