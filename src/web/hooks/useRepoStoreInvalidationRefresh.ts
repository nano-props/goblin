import { useEffect } from 'react'
import { subscribeRepoQueryInvalidation } from '#/web/repo-query-invalidation-ingress.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
export function useRepoStoreInvalidationRefresh() {
  useEffect(() => {
    return subscribeRepoQueryInvalidation((event) => {
      if (event.query !== 'repo-snapshot') return
      const state = useReposStore.getState()
      const repo = state.repos[event.repoId]
      if (!repo || repo.availability.phase === 'unavailable') return
      const token = repo.instanceToken
      void runRepoRefreshIntent(useReposStore.getState, {
        kind: 'repo-invalidated',
        id: event.repoId,
        token,
      })
    })
  }, [])
}
