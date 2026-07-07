import { useEffect, useMemo, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  isRepoVisibleProjectionRefreshable,
  runRepoRefreshIntent,
  type RepoVisibleProjectionRefreshState,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { workspacePaneTabsTargetForRepoBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { createRepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'

export { isRepoVisibleProjectionRefreshable }

interface RepoVisibleProjectionShell {
  id: string
  repoInstanceId: string
  preferredWorkspacePaneTabByTarget: RepoState['ui']['preferredWorkspacePaneTabByTarget']
  unavailable: boolean
  visibleStatusPhase: 'idle' | 'loading' | 'refreshing'
}

function currentRepoVisibleProjectionShellEqual(
  a: RepoVisibleProjectionShell | null,
  b: RepoVisibleProjectionShell | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.repoInstanceId === b.repoInstanceId &&
      a.preferredWorkspacePaneTabByTarget === b.preferredWorkspacePaneTabByTarget &&
      a.unavailable === b.unavailable &&
      a.visibleStatusPhase === b.visibleStatusPhase)
  )
}

function isVisibleProjectionWorkspacePaneTab(tab: WorkspacePaneTabType | null): boolean {
  return tab === 'status' || tab === 'changes'
}

export function useVisibleRepoProjectionRefresh({
  hydratedRouteRepoId = null,
  currentBranchName = null,
}: {
  hydratedRouteRepoId?: string | null
  currentBranchName?: string | null
} = {}) {
  const currentRepoShell = useStoreWithEqualityFn(
    useReposStore,
    (state): RepoVisibleProjectionShell | null => {
      const id = hydratedRouteRepoId
      const repo = id ? state.repos[id] : null
      return repo
        ? {
            id: repo.id,
            repoInstanceId: repo.instanceId,
            preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
            unavailable: isRepoUnavailable(repo),
            visibleStatusPhase: repo.dataLoads.visibleStatus.phase,
          }
        : null
    },
    currentRepoVisibleProjectionShellEqual,
  )
  const repoRoot = currentRepoShell?.id ?? ''
  const repoInstanceId = currentRepoShell?.repoInstanceId ?? ''
  const repoEnabled = currentRepoShell !== null
  const branchReadModel = useRepoBranchReadModel(repoRoot, repoInstanceId, repoEnabled)
  const branch = useMemo(
    () => branchReadModel?.branches.find((candidate) => candidate.name === currentBranchName) ?? null,
    [branchReadModel?.branches, currentBranchName],
  )
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repoRoot, repoInstanceId, { enabled: repoEnabled })
  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(workspacePaneTabsQuery.data ?? [], {
        repoRoot,
        branchName,
        worktreePath,
      }),
    [branchName, repoRoot, workspacePaneTabsQuery.data, worktreePath],
  )
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    repoRoot,
    repoInstanceId,
    worktreePath,
  })
  const preferredWorkspacePaneTab = useMemo(() => {
    if (!currentRepoShell || !branchReadModel) return 'status'
    const target = workspacePaneTabsTargetForRepoBranch(
      { repoRoot: currentRepoShell.id, branches: branchReadModel.branches },
      branchName,
    )
    return preferredWorkspacePaneTabForTarget(
      { preferredWorkspacePaneTabByTarget: currentRepoShell.preferredWorkspacePaneTabByTarget },
      target,
    )
  }, [branchName, branchReadModel, currentRepoShell])
  const renderedWorkspacePaneTab = useMemo<WorkspacePaneTabType | null>(() => {
    if (!currentRepoShell || !branchName) return null
    return createRepoWorkspaceTabModel({
      repoId: currentRepoShell.id,
      branchName,
      worktreePath,
      preferredTab: preferredWorkspacePaneTab,
      tabEntries: workspacePaneTabEntries,
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    }).renderedTab
  }, [
    branchName,
    currentRepoShell,
    preferredWorkspacePaneTab,
    runtimeProjection.runtimeTabStateByType,
    runtimeProjection.runtimeTabViews,
    workspacePaneTabEntries,
    worktreePath,
  ])
  const currentRepoRefreshState = useMemo<RepoVisibleProjectionRefreshState | null>(
    () =>
      currentRepoShell
        ? {
            id: currentRepoShell.id,
            repoInstanceId: currentRepoShell.repoInstanceId,
            preferredWorkspacePaneTab,
            renderedWorkspacePaneTab,
            branchName,
            visibleProjectionViewOpen: isVisibleProjectionWorkspacePaneTab(renderedWorkspacePaneTab),
            unavailable: currentRepoShell.unavailable,
            visibleStatusPhase: currentRepoShell.visibleStatusPhase,
          }
        : null,
    [branchName, currentRepoShell, preferredWorkspacePaneTab, renderedWorkspacePaneTab],
  )
  const previousCurrentRepoId = useRef<string | null>(null)
  const previousCurrentBranchName = useRef<string | null>(null)
  const previousRenderedWorkspacePaneTab = useRef<WorkspacePaneTabType | null>(null)
  const previousVisibleProjectionViewOpen = useRef<boolean>(false)

  useEffect(() => {
    const lastCurrentRepoId = previousCurrentRepoId.current
    const lastCurrentBranchName = previousCurrentBranchName.current
    const lastRenderedWorkspacePaneTab = previousRenderedWorkspacePaneTab.current
    const lastVisibleProjectionViewOpen = previousVisibleProjectionViewOpen.current
    const nextCurrentRepoId = currentRepoRefreshState?.id ?? null
    const nextCurrentBranchName = currentRepoRefreshState?.branchName ?? null
    const nextRenderedWorkspacePaneTab = currentRepoRefreshState?.renderedWorkspacePaneTab ?? null
    const nextVisibleProjectionViewOpen = currentRepoRefreshState?.visibleProjectionViewOpen ?? false
    const currentRepoChanged = nextCurrentRepoId !== lastCurrentRepoId
    const openedVisibleProjectionView =
      !currentRepoChanged && nextCurrentRepoId !== null && nextVisibleProjectionViewOpen && !lastVisibleProjectionViewOpen
    const switchedVisibleProjectionView =
      !currentRepoChanged &&
      nextCurrentRepoId !== null &&
      nextVisibleProjectionViewOpen &&
      lastVisibleProjectionViewOpen &&
      nextRenderedWorkspacePaneTab !== lastRenderedWorkspacePaneTab
    const visibleProjectionBranchChanged =
      !currentRepoChanged &&
      nextCurrentRepoId !== null &&
      nextVisibleProjectionViewOpen &&
      nextCurrentBranchName !== lastCurrentBranchName
    previousCurrentRepoId.current = nextCurrentRepoId
    previousCurrentBranchName.current = nextCurrentBranchName
    previousRenderedWorkspacePaneTab.current = nextRenderedWorkspacePaneTab
    previousVisibleProjectionViewOpen.current = nextVisibleProjectionViewOpen
    if (
      !currentRepoRefreshState ||
      (!currentRepoChanged &&
        !openedVisibleProjectionView &&
        !switchedVisibleProjectionView &&
        !visibleProjectionBranchChanged)
    ) {
      return
    }
    if (!isRepoVisibleProjectionRefreshable(currentRepoRefreshState)) return
    void runRepoRefreshIntent(useReposStore.getState, {
      kind: 'visible-runtime-projection-requested',
      reason: visibleProjectionBranchChanged ? 'visible-projection-branch-changed' : 'visible-projection-view-opened',
      id: currentRepoRefreshState.id,
      repoInstanceId: currentRepoRefreshState.repoInstanceId,
      branchName: currentRepoRefreshState.branchName,
    })
  }, [currentRepoRefreshState])
}
