import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  runRepoRefreshIntent,
  currentRepoStatusRefreshSnapshot,
  type RepoStatusRefreshSnapshot,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'

export { isRepoStatusRefreshable } from '#/web/stores/repos/refresh-coordinator.ts'

function currentRepoStatusSnapshotEqual(
  a: RepoStatusRefreshSnapshot | null,
  b: RepoStatusRefreshSnapshot | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.repoInstanceId === b.repoInstanceId &&
      a.preferredWorkspacePaneTab === b.preferredWorkspacePaneTab &&
      a.statusViewOpen === b.statusViewOpen &&
      a.unavailable === b.unavailable &&
      a.statusPhase === b.statusPhase)
  )
}

export function useRepoStatusRefresh({
  hydratedRouteRepoId = null,
  currentBranchName = null,
}: {
  hydratedRouteRepoId?: string | null
  currentBranchName?: string | null
} = {}) {
  const currentRepoSnapshot = useStoreWithEqualityFn(
    useReposStore,
    (state): RepoStatusRefreshSnapshot | null => {
      const id = hydratedRouteRepoId
      const repo = id ? state.repos[id] : null
      return repo ? currentRepoStatusRefreshSnapshot(repo, currentBranchName) : null
    },
    currentRepoStatusSnapshotEqual,
  )
  const previousCurrentRepoId = useRef<string | null>(null)
  const previousPreferredWorkspacePaneTab = useRef<WorkspacePaneTabType | null>(null)
  const previousStatusViewOpen = useRef<boolean>(false)

  useEffect(() => {
    const lastCurrentRepoId = previousCurrentRepoId.current
    const lastPreferredWorkspacePaneTab = previousPreferredWorkspacePaneTab.current
    const lastStatusViewOpen = previousStatusViewOpen.current
    const nextCurrentRepoId = currentRepoSnapshot?.id ?? null
    const nextPreferredWorkspacePaneTab = currentRepoSnapshot?.preferredWorkspacePaneTab ?? null
    const nextStatusViewOpen = currentRepoSnapshot?.statusViewOpen ?? false
    const currentRepoChanged = nextCurrentRepoId !== lastCurrentRepoId
    const openedStatusLikeTab =
      !currentRepoChanged &&
      nextCurrentRepoId !== null &&
      ((nextPreferredWorkspacePaneTab === 'status' && nextStatusViewOpen && !lastStatusViewOpen) ||
        ((nextPreferredWorkspacePaneTab === 'status' || nextPreferredWorkspacePaneTab === 'changes') &&
          nextPreferredWorkspacePaneTab !== lastPreferredWorkspacePaneTab))
    previousCurrentRepoId.current = nextCurrentRepoId
    previousPreferredWorkspacePaneTab.current = nextPreferredWorkspacePaneTab
    previousStatusViewOpen.current = nextStatusViewOpen
    if (!currentRepoSnapshot || (!currentRepoChanged && !openedStatusLikeTab)) return
    void runRepoRefreshIntent(useReposStore.getState, {
      kind: 'visible-status-like-view-opened',
      id: currentRepoSnapshot.id,
      repoInstanceId: currentRepoSnapshot.repoInstanceId,
    })
  }, [currentRepoSnapshot])
}
