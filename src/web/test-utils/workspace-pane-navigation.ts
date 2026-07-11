import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { openResolvedRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
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

export function observeWorkspacePaneRouteForTest(_observation: WorkspacePaneNavigationObservation): void {}

export function seedInitialObservedWorkspacePaneRouteForTest(
  observation?: WorkspacePaneNavigationObservation,
  options: { autoSeed?: boolean } = {},
): boolean {
  if (observation) {
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
  void route
  return true
}

export function observedWorkspacePaneRouteCommitForTest(
  navigation: Pick<
    PrimaryWindowNavigationActions,
    'showRepoBranchEmptyWorkspacePane' | 'showRepoBranchWorkspacePaneTab' | 'showRepoBranchTerminalSession'
  >,
  options: {
    observeAcceptedRoute?: (observation: WorkspacePaneNavigationObservation) => void
    commitRoute?: PrimaryWindowNavigationActions['commitRepoBranchWorkspacePaneRoute']
  } = {},
): PrimaryWindowNavigationActions['commitRepoBranchWorkspacePaneRoute'] {
  const observeAcceptedRoute = options.observeAcceptedRoute ?? (() => {})
  const observeCommittedRoute = (
    repoId: string,
    branchName: string,
    route: ParsedRepoBranchWorkspacePaneRoute | null,
  ): void => {
    const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: route })
    if (!target?.branchName) return
    observeAcceptedRoute({
      repoId: target.repoId,
      repoRuntimeId: target.repoRuntimeId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
      route,
    })
  }
  if (options.commitRoute) {
    return (repoId, branchName, route, commitOptions) =>
      options.commitRoute!(repoId, branchName, route, {
        ...commitOptions,
        onCommit: () => {
          commitOptions?.onCommit?.()
          observeCommittedRoute(repoId, branchName, route)
        },
      })
  }
  return (repoId, branchName, route, commitOptions) => {
    if (
      commitOptions?.expectedCurrentRoute !== undefined &&
      workspacePaneRoutesEqual(commitOptions.expectedCurrentRoute, route)
    ) {
      commitOptions.onCommit?.()
      observeCommittedRoute(repoId, branchName, route)
      return true
    }
    const routeOptions = commitOptions?.replace === undefined ? undefined : { replace: commitOptions.replace }
    const accepted = openResolvedRepoBranchWorkspacePaneRoute(
      {
        openRepoBranch: navigation.showRepoBranchEmptyWorkspacePane,
        openRepoBranchTab: navigation.showRepoBranchWorkspacePaneTab,
        openRepoBranchTerminal: navigation.showRepoBranchTerminalSession,
      },
      repoId,
      branchName,
      route,
      routeOptions,
    )
    const observeIfAccepted = (didAccept: boolean): boolean => {
      if (!didAccept) return false
      commitOptions?.onCommit?.()
      observeCommittedRoute(repoId, branchName, route)
      return true
    }
    return observeIfAccepted(accepted)
  }
}

function workspacePaneRoutesEqual(
  a: ParsedRepoBranchWorkspacePaneRoute | null,
  b: ParsedRepoBranchWorkspacePaneRoute | null,
): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'static') return b.kind === 'static' && a.tab === b.tab
  if (a.kind === 'terminal') return b.kind === 'terminal' && a.terminalSessionId === b.terminalSessionId
  return b.kind === 'invalid-static' && a.tabKey === b.tabKey
}
