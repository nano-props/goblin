import { afterEach, vi } from 'vitest'
import type { ParsedWorkspacePaneRoute, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { AppNavigationActions, AppNavigationOptions } from '#/web/app-navigation-actions.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'

export interface ObservedBranchRouteNavigationForTest {
  showRepoBranchEmptyWorkspacePane: (
    workspaceId: WorkspaceId,
    branchName: string,
    options?: AppNavigationOptions,
  ) => boolean
  showRepoBranchWorkspacePaneTab: (
    workspaceId: WorkspaceId,
    branchName: string,
    tab: Extract<WorkspacePaneRouteTarget, { kind: 'static' }>['tab'],
    options?: AppNavigationOptions,
  ) => boolean
  showRepoBranchTerminalSession: (
    workspaceId: WorkspaceId,
    branchName: string,
    terminalSessionId: string,
    options?: AppNavigationOptions,
  ) => boolean
}

type ObservedAppNavigationOverrides = Partial<AppNavigationActions> & ObservedBranchRouteNavigationForTest
export type AppNavigationOverridesForTest = Partial<AppNavigationActions> &
  Partial<ObservedBranchRouteNavigationForTest>
export type ObservedAppNavigationActionsForTest = AppNavigationActions & ObservedBranchRouteNavigationForTest

interface ObservedWorkspacePaneRouteCommitOptions {
  observeAcceptedRoute?: (observation: WorkspacePaneNavigationObservation) => void
  commitRoute?: AppNavigationActions['commitWorkspacePaneRoute']
}

export interface WorkspacePaneNavigationObservation {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
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
  const state = workspacesStore.getState()
  const repoId = state.restoredWorkspaceId
  const repo = repoId ? state.workspaces[repoId] : null
  if (!repoId || !repo) return false
  const branchName = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.current
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
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
    route,
  })
  return true
}

export function observedWorkspacePaneRouteCommitForTest(
  navigation: Partial<ObservedBranchRouteNavigationForTest>,
  options: ObservedWorkspacePaneRouteCommitOptions = {},
): AppNavigationActions['commitWorkspacePaneRoute'] {
  const observeAcceptedRoute = options.observeAcceptedRoute ?? (() => {})
  const observeCommittedRoute = (
    repoId: WorkspaceId,
    branchName: string,
    route: ParsedWorkspacePaneRoute | null,
  ): void => {
    const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: route })
    if (!target?.branchName) return
    const observation = {
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
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
  const { showRepoBranchEmptyWorkspacePane, showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession } = navigation
  if (!showRepoBranchEmptyWorkspacePane || !showRepoBranchWorkspacePaneTab || !showRepoBranchTerminalSession) {
    throw new Error('Observed workspace pane route commits require branch route callbacks')
  }
  const abandonCommit = (commitOptions: AppNavigationOptions | undefined) => {
    commitOptions?.onAbandon?.()
    return false
  }
  return async (repoId, branchName, route, commitOptions) => {
    if (commitOptions?.routePrecondition?.kind === 'current-workspace-target') {
      const currentRoute = observedWorkspacePaneRouteForTarget(repoId, branchName)
      if (currentRoute === undefined) return abandonCommit(commitOptions)
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
        return abandonCommit(commitOptions)
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
        openRepoBranch: showRepoBranchEmptyWorkspacePane,
        openRepoBranchTab: showRepoBranchWorkspacePaneTab,
        openRepoBranchTerminal: showRepoBranchTerminalSession,
      },
      repoId,
      branchName,
      route,
      routeOptions,
    )
    const observeIfAccepted = (didAccept: boolean): boolean => {
      if (!didAccept) return abandonCommit(commitOptions)
      commitOptions?.onCommit?.()
      observeCommittedRoute(repoId, branchName, route)
      return true
    }
    return observeIfAccepted(accepted)
  }
}

/** Builds a provider value whose route commit is backed by the test's observed URL projection. */
export function observedAppNavigationActionsForTest(
  overrides: ObservedAppNavigationOverrides,
  options: ObservedWorkspacePaneRouteCommitOptions = {},
): ObservedAppNavigationActionsForTest {
  const {
    showRepoBranchEmptyWorkspacePane,
    showRepoBranchWorkspacePaneTab,
    showRepoBranchTerminalSession,
    ...navigationOverrides
  } = overrides
  const navigation = appNavigationActionsForTest(navigationOverrides)
  const observedNavigation = {
    ...navigation,
    showRepoBranchEmptyWorkspacePane,
    showRepoBranchWorkspacePaneTab,
    showRepoBranchTerminalSession,
  }
  if (overrides.commitWorkspacePaneRoute) return observedNavigation
  return {
    ...observedNavigation,
    commitWorkspacePaneRoute: vi.fn(
      observedWorkspacePaneRouteCommitForTest(
        { showRepoBranchEmptyWorkspacePane, showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession },
        options,
      ),
    ),
  }
}

export function observedWorkspacePaneRouteForTarget(
  repoId: WorkspaceId,
  branchName: string,
): WorkspacePaneRouteTarget | undefined {
  const target = workspacePaneTabTargetForBranch(repoId, branchName, workspacePanePreferenceTargetOptions)
  if (!target?.branchName) return undefined
  const route = observedWorkspacePaneRoutes.get(
    workspacePaneObservationKey({
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
    }),
  )
  return route?.kind === 'invalid-static' ? undefined : route
}

function workspacePaneObservationKey(observation: Omit<WorkspacePaneNavigationObservation, 'route'>): string {
  return [
    observation.workspaceId,
    observation.workspaceRuntimeId,
    observation.branchName,
    observation.worktreePath ?? '',
  ].join('\0')
}

function workspacePaneRoutesEqual(a: ParsedWorkspacePaneRoute | null, b: ParsedWorkspacePaneRoute | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'static') return b.kind === 'static' && a.tab === b.tab
  if (a.kind === 'terminal') return b.kind === 'terminal' && a.terminalSessionId === b.terminalSessionId
  return b.kind === 'invalid-static' && a.tabKey === b.tabKey
}
