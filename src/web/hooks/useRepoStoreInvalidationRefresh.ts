import { useEffect } from 'react'
import { subscribeRepoReadInvalidation } from '#/web/repo-read-invalidation-ingress.ts'
import {
  handleRepoInvalidationRefresh,
  resyncActiveRepoReadQueries,
} from '#/web/stores/workspaces/repo-refresh-actions.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { goblinLog } from '#/web/logger.ts'
export function useRepoStoreInvalidationRefresh() {
  useEffect(() => {
    const store = { get: useWorkspacesStore.getState }
    return subscribeRepoReadInvalidation(
      (event) => {
        const repo = store.get().workspaces[event.repoId]
        if (!repo) return
        void handleRepoInvalidationRefresh(store, event, repo.workspaceRuntimeId).catch((error) => {
          goblinLog.warn('repo invalidation refresh failed', { repoId: event.repoId, domain: event.domain, error })
        })
      },
      () => {
        void resyncActiveRepoReadQueries(store).catch((error) => {
          goblinLog.warn('repo invalidation connection resync failed', { error })
        })
      },
    )
  }, [])
}
