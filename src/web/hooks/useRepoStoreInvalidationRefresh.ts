import { useEffect } from 'react'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { handleRepoInvalidationRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
export function useRepoStoreInvalidationRefresh() {
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      if (event.query !== 'repo-snapshot') return
      const state = useReposStore.getState()
      const repo = state.repos[event.repoId]
      if (!repo || isRepoUnavailable(repo)) return
      const token = repo.instanceToken
      void handleRepoInvalidationRefresh(useReposStore.getState, event, token)
    })
  }, [])
}
