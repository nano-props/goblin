import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'

export const HEURISTIC_REPO_STATUS_REFRESH_TTL_MS = 10_000

interface ActiveRepoStatusSnapshot {
  id: string
  token: number
  detailTab: DetailTab
  availability: 'available' | 'unavailable'
  statusLoaded: boolean
  statusPhase: 'idle' | 'loading' | 'refreshing'
  statusLoadedAt: number | null
  statusStale: boolean
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
      a.statusLoaded === b.statusLoaded &&
      a.statusPhase === b.statusPhase &&
      a.statusLoadedAt === b.statusLoadedAt &&
      a.statusStale === b.statusStale)
  )
}

export function shouldHeuristicallyRefreshRepoStatus(
  repo: Pick<
    ActiveRepoStatusSnapshot,
    'availability' | 'statusLoaded' | 'statusPhase' | 'statusLoadedAt' | 'statusStale'
  >,
  now: number = Date.now(),
): boolean {
  if (repo.availability !== 'available') return false
  if (repo.statusPhase !== 'idle') return false
  if (repo.statusStale) return true
  if (!repo.statusLoaded || repo.statusLoadedAt === null) return false
  return now - repo.statusLoadedAt >= HEURISTIC_REPO_STATUS_REFRESH_TTL_MS
}

export function useHeuristicRepoStatusRefresh() {
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
        statusLoaded: repo.data.statusLoaded,
        statusPhase: repo.resources.status.phase,
        statusLoadedAt: repo.resources.status.loadedAt,
        statusStale: repo.resources.status.stale,
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
    if (!shouldHeuristicallyRefreshRepoStatus(activeRepo)) return
    void useReposStore.getState().refreshStatus(activeRepo.id, { token: activeRepo.token })
  }, [activeRepo])
}
