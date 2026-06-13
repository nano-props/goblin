import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'

interface ActiveRepoStatusSnapshot {
  id: string
  token: number
  detailTab: DetailTab
  availability: 'available' | 'unavailable'
  statusPhase: 'idle' | 'loading' | 'refreshing'
}

function activeRepoStatusSnapshotEqual(
  a: ActiveRepoStatusSnapshot | null,
  b: ActiveRepoStatusSnapshot | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.token === b.token &&
      a.detailTab === b.detailTab &&
      a.availability === b.availability &&
      a.statusPhase === b.statusPhase)
  )
}

// Basic gate: don't kick off a refresh for an unavailable repo, and don't
// double-fire while a previous refresh is still in flight. Concurrency is
// the only thing the gate protects against; rate limiting is intentionally
// not implemented here. The IPC round trip + server-side `git status` cost
// acts as a natural throttle, and the user opening a status-like tab or
// switching repos is an explicit "I want fresh data" signal — we shouldn't
// second-guess it.
export function isRepoStatusRefreshable(repo: ActiveRepoStatusSnapshot): boolean {
  return repo.availability === 'available' && repo.statusPhase === 'idle'
}

export function useRepoStatusRefresh() {
  const activeRepo = useStoreWithEqualityFn(
    useReposStore,
    (state): ActiveRepoStatusSnapshot | null => {
      const id = state.activeId
      const repo = id ? state.repos[id] : null
      if (!repo) return null
      return {
        id: repo.id,
        token: repo.instanceToken,
        detailTab: repo.ui.detailTab,
        availability: repo.availability.phase,
        statusPhase: repo.resources.status.phase,
      }
    },
    activeRepoStatusSnapshotEqual,
  )
  const previousActiveRepoId = useRef<string | null>(null)
  const previousDetailTab = useRef<DetailTab | null>(null)

  useEffect(() => {
    const lastActiveRepoId = previousActiveRepoId.current
    const lastDetailTab = previousDetailTab.current
    const nextActiveRepoId = activeRepo?.id ?? null
    const nextDetailTab = activeRepo?.detailTab ?? null
    const activeRepoChanged = nextActiveRepoId !== lastActiveRepoId
    const openedStatusLikeTab =
      !activeRepoChanged &&
      nextActiveRepoId !== null &&
      (nextDetailTab === 'status' || nextDetailTab === 'changes') &&
      nextDetailTab !== lastDetailTab
    previousActiveRepoId.current = nextActiveRepoId
    previousDetailTab.current = nextDetailTab
    if (!activeRepo || (!activeRepoChanged && !openedStatusLikeTab)) return
    if (!isRepoStatusRefreshable(activeRepo)) return
    void useReposStore.getState().refreshStatus(activeRepo.id, { token: activeRepo.token })
  }, [activeRepo])
}
