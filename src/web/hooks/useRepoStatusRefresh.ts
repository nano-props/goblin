import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  repoStatusRefreshSnapshot,
  runRepoRefreshIntent,
  type RepoStatusRefreshSnapshot,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

export { isRepoStatusRefreshable } from '#/web/stores/repos/refresh-coordinator.ts'

function activeRepoStatusSnapshotEqual(
  a: RepoStatusRefreshSnapshot | null,
  b: RepoStatusRefreshSnapshot | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.token === b.token &&
      a.workspacePaneView === b.workspacePaneView &&
      a.statusViewOpen === b.statusViewOpen &&
      a.unavailable === b.unavailable &&
      a.statusPhase === b.statusPhase)
  )
}

export function useRepoStatusRefresh() {
  const activeRepo = useStoreWithEqualityFn(
    useReposStore,
    (state): RepoStatusRefreshSnapshot | null => {
      const id = state.activeId
      const repo = id ? state.repos[id] : null
      return repo ? repoStatusRefreshSnapshot(repo) : null
    },
    activeRepoStatusSnapshotEqual,
  )
  const previousActiveRepoId = useRef<string | null>(null)
  const previousWorkspacePaneView = useRef<WorkspacePaneView | null>(null)
  const previousStatusViewOpen = useRef<boolean>(false)

  useEffect(() => {
    const lastActiveRepoId = previousActiveRepoId.current
    const lastWorkspacePaneView = previousWorkspacePaneView.current
    const lastStatusViewOpen = previousStatusViewOpen.current
    const nextActiveRepoId = activeRepo?.id ?? null
    const nextWorkspacePaneView = activeRepo?.workspacePaneView ?? null
    const nextStatusViewOpen = activeRepo?.statusViewOpen ?? false
    const activeRepoChanged = nextActiveRepoId !== lastActiveRepoId
    const openedStatusLikeTab =
      !activeRepoChanged &&
      nextActiveRepoId !== null &&
      ((nextWorkspacePaneView === 'status' && nextStatusViewOpen && !lastStatusViewOpen) ||
        ((nextWorkspacePaneView === 'status' || nextWorkspacePaneView === 'changes') &&
          nextWorkspacePaneView !== lastWorkspacePaneView))
    previousActiveRepoId.current = nextActiveRepoId
    previousWorkspacePaneView.current = nextWorkspacePaneView
    previousStatusViewOpen.current = nextStatusViewOpen
    if (!activeRepo || (!activeRepoChanged && !openedStatusLikeTab)) return
    void runRepoRefreshIntent(useReposStore.getState, {
      kind: 'visible-status-like-view-opened',
      id: activeRepo.id,
      token: activeRepo.token,
    })
  }, [activeRepo])
}
