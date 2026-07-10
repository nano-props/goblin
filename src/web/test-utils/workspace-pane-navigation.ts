import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { openResolvedRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import { observeWorkspacePaneTabControllerRoute } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

export interface WorkspacePaneNavigationObservation {
  repoId: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  route: ParsedRepoBranchWorkspacePaneRoute | null
}

export function seedInitialObservedWorkspacePaneRouteForTest(
  observation?: WorkspacePaneNavigationObservation,
  options: { autoSeed?: boolean } = {},
): boolean {
  if (observation) {
    observeWorkspacePaneTabControllerRoute(observation)
    return true
  }
  if (options.autoSeed === false) return false
  const state = useReposStore.getState()
  const repoId = state.restoredRepoId
  const repo = repoId ? state.repos[repoId] : null
  if (!repoId || !repo) return false
  const branchName = readRepoBranchQueryProjection(repo)?.currentBranch
  if (!branchName) return false
  const target = workspacePaneTabTargetForBranch(repoId, branchName, workspacePanePreferenceTargetOptions)
  if (!target?.branchName) return false
  const activeTab = target.activeTab
  const route: ParsedRepoBranchWorkspacePaneRoute | null =
    activeTab?.kind === 'static'
      ? { kind: 'static', tab: activeTab.type }
      : activeTab?.kind === 'runtime' && activeTab.runtimeType === 'terminal'
        ? { kind: 'terminal', terminalSessionId: activeTab.sessionId }
        : null
  observeWorkspacePaneTabControllerRoute({
    repoId: target.repoId,
    repoRuntimeId: target.repoRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
    route,
  })
  return true
}

export function observedWorkspacePaneRouteCommitForTest(
  navigation: Pick<
    PrimaryWindowNavigationActions,
    'showRepoBranchEmptyWorkspacePane' | 'showRepoBranchWorkspacePaneTab' | 'showRepoBranchTerminalSession'
  >,
  options: {
    observeAcceptedRoute?: (observation: WorkspacePaneNavigationObservation) => void
  } = {},
): PrimaryWindowNavigationActions['commitRepoBranchWorkspacePaneRoute'] {
  const observeAcceptedRoute = options.observeAcceptedRoute ?? observeWorkspacePaneTabControllerRoute
  return (repoId, branchName, route, commitOptions) => {
    const accepted = openResolvedRepoBranchWorkspacePaneRoute(
      {
        openRepoBranch: navigation.showRepoBranchEmptyWorkspacePane,
        openRepoBranchTab: navigation.showRepoBranchWorkspacePaneTab,
        openRepoBranchTerminal: navigation.showRepoBranchTerminalSession,
      },
      repoId,
      branchName,
      route,
      commitOptions,
    )
    const observeIfAccepted = (didAccept: boolean): boolean => {
      if (!didAccept) return false
      const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: route })
      if (target?.branchName) {
        observeAcceptedRoute({
          repoId: target.repoId,
          repoRuntimeId: target.repoRuntimeId,
          branchName: target.branchName,
          worktreePath: target.worktreePath,
          route,
        })
      }
      return true
    }
    return observeIfAccepted(accepted)
  }
}
