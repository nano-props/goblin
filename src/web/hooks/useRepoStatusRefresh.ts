import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  repoStatusRefreshSnapshot,
  runRepoRefreshIntent,
  type RepoStatusRefreshSnapshot,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'

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
      a.preferredWorkspacePaneView === b.preferredWorkspacePaneView &&
      a.statusViewOpen === b.statusViewOpen &&
      a.unavailable === b.unavailable &&
      a.statusPhase === b.statusPhase)
  )
}

export function useRepoStatusRefresh() {
  const activeRepoId = useStoreWithEqualityFn(
    useReposStore,
    (state): RepoStatusRefreshSnapshot | null => {
      const id = state.activeId
      const repo = id ? state.repos[id] : null
      return repo ? repoStatusRefreshSnapshot(repo) : null
    },
    activeRepoStatusSnapshotEqual,
  )
  const previousActiveRepoId = useRef<string | null>(null)
  const previousPreferredWorkspacePaneView = useRef<WorkspacePaneTabType | null>(null)
  const previousStatusViewOpen = useRef<boolean>(false)

  useEffect(() => {
    const lastActiveRepoId = previousActiveRepoId.current
    const lastPreferredWorkspacePaneView = previousPreferredWorkspacePaneView.current
    const lastStatusViewOpen = previousStatusViewOpen.current
    const nextActiveRepoId = activeRepoId?.id ?? null
    const nextPreferredWorkspacePaneView = activeRepoId?.preferredWorkspacePaneView ?? null
    const nextStatusViewOpen = activeRepoId?.statusViewOpen ?? false
    const activeRepoChanged = nextActiveRepoId !== lastActiveRepoId
    const openedStatusLikeTab =
      !activeRepoChanged &&
      nextActiveRepoId !== null &&
      ((nextPreferredWorkspacePaneView === 'status' && nextStatusViewOpen && !lastStatusViewOpen) ||
        ((nextPreferredWorkspacePaneView === 'status' || nextPreferredWorkspacePaneView === 'changes') &&
          nextPreferredWorkspacePaneView !== lastPreferredWorkspacePaneView))
    previousActiveRepoId.current = nextActiveRepoId
    previousPreferredWorkspacePaneView.current = nextPreferredWorkspacePaneView
    previousStatusViewOpen.current = nextStatusViewOpen
    if (!activeRepoId || (!activeRepoChanged && !openedStatusLikeTab)) return
    void runRepoRefreshIntent(useReposStore.getState, {
      kind: 'visible-status-like-view-opened',
      id: activeRepoId.id,
      token: activeRepoId.token,
    })
  }, [activeRepoId])
}
