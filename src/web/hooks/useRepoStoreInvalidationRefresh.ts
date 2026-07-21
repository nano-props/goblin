import { useEffect } from 'react'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { handleRepoInvalidationRefresh } from '#/web/stores/workspaces/repo-refresh-actions.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { goblinLog } from '#/web/logger.ts'
import { isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
export function useRepoStoreInvalidationRefresh() {
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      const state = useWorkspacesStore.getState()
      const repo = state.workspaces[event.repoId]
      if (!repo) return
      if (event.lastFetchAt !== undefined && isGitWorkspace(repo)) {
        updateIfFresh(useWorkspacesStore.setState, event.repoId, repo.workspaceRuntimeId, (currentRepo) => {
          if (isGitWorkspace(currentRepo)) currentRepo.capability.git.lastFetchAt = event.lastFetchAt!
        })
      }
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
