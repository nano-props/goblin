import { afterEach } from 'vitest'
import type { ParsedWorkspacePaneRoute, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
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
  route: ParsedWorkspacePaneRoute | null
}

const observedWorkspacePaneRoutes = new Map<string, ParsedWorkspacePaneRoute | null>()

afterEach(() => observedWorkspacePaneRoutes.clear())

export function observeWorkspacePaneRouteForTest(observation: WorkspacePaneNavigationObservation): void {
  observedWorkspacePaneRoutes.set(workspacePaneObservationKey(observation), observation.route)
}

export function seedInitialObservedWorkspacePaneRouteForTest(
  observation?: WorkspacePaneNavigationObservation,
  options: { autoSeed?: boolean } = {},
): boolean {
  if (observation) {
    observeWorkspacePaneRouteForTest(observation)
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
  const route: ParsedWorkspacePaneRoute | null =
    activeTab?.kind === 'static'
      ? { kind: 'static', tab: activeTab.type }
      : activeTab?.kind === 'runtime' && activeTab.runtimeType === 'terminal'
        ? { kind: 'terminal', terminalSessionId: activeTab.sessionId }
        : null
  observeWorkspacePaneRouteForTest({
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
    commitRoute?: PrimaryWindowNavigationActions['commitWorkspacePaneRoute']
  } = {},
): PrimaryWindowNavigationActions['commitWorkspacePaneRoute'] {
  const observeAcceptedRoute = options.observeAcceptedRoute ?? (() => {})
  const observeCommittedRoute = (
    repoId: string,
    branchName: string,
    route: ParsedWorkspacePaneRoute | null,
  ): void => {
    const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: route })
    if (!target?.branchName) return
    const observation = {
      repoId: target.repoId,
      repoRuntimeId: target.repoRuntimeId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
      route,
    }
    observeWorkspacePaneRouteForTest(observation)
    observeAcceptedRoute(observation)
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
    if (commitOptions?.routePrecondition?.kind === 'current-workspace-target') {
      const currentRoute = observedWorkspacePaneRouteForTarget(repoId, branchName)
      if (currentRoute === undefined) return false
      if (workspacePaneRoutesEqual(currentRoute, route)) {
        commitOptions.onCommit?.()
        observeCommittedRoute(repoId, branchName, route)
        return true
      }
    }
    if (commitOptions?.routePrecondition?.kind === 'exact-route') {
      const currentRoute = observedWorkspacePaneRouteForTarget(repoId, branchName)
      if (
        currentRoute === undefined ||
        !workspacePaneRoutesEqual(currentRoute, commitOptions.routePrecondition.route)
      ) {
        return false
      }
      if (workspacePaneRoutesEqual(currentRoute, route)) {
        commitOptions.onCommit?.()
        observeCommittedRoute(repoId, branchName, route)
        return true
      }
    }
    const routeOptions = commitOptions?.replace === undefined ? undefined : { replace: commitOptions.replace }
    const accepted = openResolvedWorkspacePaneRoute(
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

export function observedWorkspacePaneRouteForTarget(
  repoId: string,
  branchName: string,
): WorkspacePaneRouteTarget | undefined {
  const target = workspacePaneTabTargetForBranch(repoId, branchName, workspacePanePreferenceTargetOptions)
  if (!target?.branchName) return undefined
  const route = observedWorkspacePaneRoutes.get(
    workspacePaneObservationKey({
      repoId: target.repoId,
      repoRuntimeId: target.repoRuntimeId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
    }),
  )
  return route?.kind === 'invalid-static' ? undefined : route
}

function workspacePaneObservationKey(observation: Omit<WorkspacePaneNavigationObservation, 'route'>): string {
  return [observation.repoId, observation.repoRuntimeId, observation.branchName, observation.worktreePath ?? ''].join(
    '\0',
  )
}

function workspacePaneRoutesEqual(
  a: ParsedWorkspacePaneRoute | null,
  b: ParsedWorkspacePaneRoute | null,
): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'static') return b.kind === 'static' && a.tab === b.tab
  if (a.kind === 'terminal') return b.kind === 'terminal' && a.terminalSessionId === b.terminalSessionId
  return b.kind === 'invalid-static' && a.tabKey === b.tabKey
}
