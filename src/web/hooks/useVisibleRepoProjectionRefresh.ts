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
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-target-projection.ts'
import { createRepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { useRepoProjectionReadModel } from '#/web/repo-data-query.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

export { isRepoVisibleProjectionRefreshable }

interface RepoVisibleProjectionShell {
  id: string
  repoRuntimeId: string
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
      a.repoRuntimeId === b.repoRuntimeId &&
      a.preferredWorkspacePaneTabByTarget === b.preferredWorkspacePaneTabByTarget &&
      a.unavailable === b.unavailable &&
      a.visibleStatusPhase === b.visibleStatusPhase)
  )
}

function isVisibleProjectionWorkspacePaneTab(tab: WorkspacePaneTabType | null): boolean {
  return tab === 'status' || tab === 'changes'
}

function visibleProjectionRefreshKey(repo: RepoVisibleProjectionRefreshState): string | null {
  if (!repo.visibleProjectionViewOpen || !repo.branchName || !repo.renderedWorkspacePaneTab) return null
  return [repo.id, repo.repoRuntimeId, repo.branchName, repo.renderedWorkspacePaneTab].join('\0')
}

export function useVisibleRepoProjectionRefresh({
  hydratedRouteRepoId = null,
  currentBranchName = null,
  workspacePaneRoute,
}: {
  hydratedRouteRepoId?: string | null
  currentBranchName?: string | null
  workspacePaneRoute?: ParsedRepoBranchWorkspacePaneRoute | null
} = {}) {
  const currentRepoShell = useStoreWithEqualityFn(
    useReposStore,
    (state): RepoVisibleProjectionShell | null => {
      const id = hydratedRouteRepoId
      const repo = id ? state.repos[id] : null
      return repo
        ? {
            id: repo.id,
            repoRuntimeId: repo.repoRuntimeId,
            preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
            unavailable: isRepoUnavailable(repo),
            visibleStatusPhase: repo.dataLoads.visibleStatus.phase,
          }
        : null
    },
    currentRepoVisibleProjectionShellEqual,
  )
  const repoRoot = currentRepoShell?.id ?? ''
  const repoRuntimeId = currentRepoShell?.repoRuntimeId ?? ''
  const repoEnabled = currentRepoShell !== null
  const projectionReadModel = useRepoProjectionReadModel(
    repoRoot,
    repoRuntimeId,
    currentBranchName,
    'full',
    repoEnabled,
  )
  const projection = projectionReadModel.data
  const branchReadModel = useMemo(
    () => (projection?.snapshot ? repoBranchReadModelFromSnapshot(projection.snapshot, projection.status) : null),
    [projection],
  )
  const branch = useMemo(
    () => branchReadModel?.branches.find((candidate) => candidate.name === currentBranchName) ?? null,
    [branchReadModel?.branches, currentBranchName],
  )
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repoRoot, repoRuntimeId, { enabled: repoEnabled })
  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(workspacePaneTabsQuery.data ?? { revision: 0, entries: [] }, {
        repoRoot,
        branchName,
        worktreePath,
      }),
    [branchName, repoRoot, workspacePaneTabsQuery.data, worktreePath],
  )
  const runtimeProjection = useWorkspacePaneRuntimeTabTargetProjection({
    repoRoot,
    repoRuntimeId,
    worktreePath,
  })
  const preferredWorkspacePaneTab = useMemo<WorkspacePaneTabType | null>(() => {
    if (workspacePaneRoute === null) return null
    if (workspacePaneRoute?.kind === 'static') return workspacePaneRoute.tab
    if (workspacePaneRoute?.kind === 'terminal') return 'terminal'
    if (workspacePaneRoute?.kind === 'invalid-static') return null
    if (!currentRepoShell || !branchReadModel) return null
    return preferredWorkspacePaneTabForTarget(
      { preferredWorkspacePaneTabByTarget: currentRepoShell.preferredWorkspacePaneTabByTarget },
      branchName ? { repoRoot: currentRepoShell.id, branchName, worktreePath } : null,
    )
  }, [branchName, branchReadModel, currentRepoShell, workspacePaneRoute, worktreePath])
  const renderedWorkspacePaneTab = useMemo<WorkspacePaneTabType | null>(() => {
    if (!currentRepoShell || !branchName) return null
    return createRepoWorkspaceTabModel({
      repoId: currentRepoShell.id,
      repoRuntimeId,
      branchName,
      worktreePath,
      preferredTab: preferredWorkspacePaneTab,
      allowPreferredTabFallback: workspacePaneRoute === undefined,
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
    workspacePaneRoute,
    worktreePath,
  ])
  const currentRepoRefreshState = useMemo<RepoVisibleProjectionRefreshState | null>(
    () =>
      currentRepoShell
        ? {
            id: currentRepoShell.id,
            repoRuntimeId: currentRepoShell.repoRuntimeId,
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
  const lastRequestedVisibleProjectionKey = useRef<string | null>(null)
  const lastRequestedBranchName = useRef<string | null>(null)

  useEffect(() => {
    if (!currentRepoRefreshState) {
      lastRequestedVisibleProjectionKey.current = null
      lastRequestedBranchName.current = null
      return
    }
    const nextVisibleProjectionKey = visibleProjectionRefreshKey(currentRepoRefreshState)
    if (!nextVisibleProjectionKey) {
      lastRequestedVisibleProjectionKey.current = null
      lastRequestedBranchName.current = null
      return
    }
    if (nextVisibleProjectionKey === lastRequestedVisibleProjectionKey.current) return
    if (!isRepoVisibleProjectionRefreshable(currentRepoRefreshState)) return
    const previousBranchName = lastRequestedBranchName.current
    lastRequestedVisibleProjectionKey.current = nextVisibleProjectionKey
    lastRequestedBranchName.current = currentRepoRefreshState.branchName
    void runRepoRefreshIntent({ get: useReposStore.getState, set: useReposStore.setState }, {
      kind: 'visible-runtime-projection-requested',
      reason:
        previousBranchName !== null && previousBranchName !== currentRepoRefreshState.branchName
          ? 'visible-projection-branch-changed'
          : 'visible-projection-view-opened',
      id: currentRepoRefreshState.id,
      repoRuntimeId: currentRepoRefreshState.repoRuntimeId,
      branchName: currentRepoRefreshState.branchName,
    })
  }, [currentRepoRefreshState])
}
