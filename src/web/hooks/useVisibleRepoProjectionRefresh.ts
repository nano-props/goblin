import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  runRepoRefreshIntent,
  currentRepoVisibleProjectionRefreshState,
  type RepoVisibleProjectionRefreshState,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'

export { isRepoVisibleProjectionRefreshable } from '#/web/stores/repos/refresh-coordinator.ts'

function currentRepoVisibleProjectionRefreshStateEqual(
  a: RepoVisibleProjectionRefreshState | null,
  b: RepoVisibleProjectionRefreshState | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.repoInstanceId === b.repoInstanceId &&
      a.preferredWorkspacePaneTab === b.preferredWorkspacePaneTab &&
      a.branchName === b.branchName &&
      a.visibleProjectionViewOpen === b.visibleProjectionViewOpen &&
      a.unavailable === b.unavailable &&
      a.visibleStatusPhase === b.visibleStatusPhase)
  )
}

export function useVisibleRepoProjectionRefresh({
  hydratedRouteRepoId = null,
  currentBranchName = null,
}: {
  hydratedRouteRepoId?: string | null
  currentBranchName?: string | null
} = {}) {
  const currentRepoRefreshState = useStoreWithEqualityFn(
    useReposStore,
    (state): RepoVisibleProjectionRefreshState | null => {
      const id = hydratedRouteRepoId
      const repo = id ? state.repos[id] : null
      return repo ? currentRepoVisibleProjectionRefreshState(repo, currentBranchName) : null
    },
    currentRepoVisibleProjectionRefreshStateEqual,
  )
  const previousCurrentRepoId = useRef<string | null>(null)
  const previousCurrentBranchName = useRef<string | null>(null)
  const previousPreferredWorkspacePaneTab = useRef<WorkspacePaneTabType | null>(null)
  const previousVisibleProjectionViewOpen = useRef<boolean>(false)

  useEffect(() => {
    const lastCurrentRepoId = previousCurrentRepoId.current
    const lastCurrentBranchName = previousCurrentBranchName.current
    const lastPreferredWorkspacePaneTab = previousPreferredWorkspacePaneTab.current
    const lastVisibleProjectionViewOpen = previousVisibleProjectionViewOpen.current
    const nextCurrentRepoId = currentRepoRefreshState?.id ?? null
    const nextCurrentBranchName = currentRepoRefreshState?.branchName ?? null
    const nextPreferredWorkspacePaneTab = currentRepoRefreshState?.preferredWorkspacePaneTab ?? null
    const nextVisibleProjectionViewOpen = currentRepoRefreshState?.visibleProjectionViewOpen ?? false
    const currentRepoChanged = nextCurrentRepoId !== lastCurrentRepoId
    const openedVisibleProjectionView =
      !currentRepoChanged &&
      nextCurrentRepoId !== null &&
      ((nextPreferredWorkspacePaneTab === 'status' &&
        nextVisibleProjectionViewOpen &&
        !lastVisibleProjectionViewOpen) ||
        ((nextPreferredWorkspacePaneTab === 'status' || nextPreferredWorkspacePaneTab === 'changes') &&
          nextPreferredWorkspacePaneTab !== lastPreferredWorkspacePaneTab))
    const visibleProjectionBranchChanged =
      !currentRepoChanged &&
      nextCurrentRepoId !== null &&
      nextVisibleProjectionViewOpen &&
      nextCurrentBranchName !== lastCurrentBranchName
    previousCurrentRepoId.current = nextCurrentRepoId
    previousCurrentBranchName.current = nextCurrentBranchName
    previousPreferredWorkspacePaneTab.current = nextPreferredWorkspacePaneTab
    previousVisibleProjectionViewOpen.current = nextVisibleProjectionViewOpen
    if (!currentRepoRefreshState || (!currentRepoChanged && !openedVisibleProjectionView && !visibleProjectionBranchChanged)) {
      return
    }
    void runRepoRefreshIntent(useReposStore.getState, {
      kind: 'visible-runtime-projection-requested',
      reason: visibleProjectionBranchChanged ? 'visible-projection-branch-changed' : 'visible-projection-view-opened',
      id: currentRepoRefreshState.id,
      repoInstanceId: currentRepoRefreshState.repoInstanceId,
      branchName: currentRepoRefreshState.branchName,
    })
  }, [currentRepoRefreshState])
}
