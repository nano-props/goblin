import { afterEach, vi } from 'vitest'
import type { ParsedWorkspacePaneRoute, WorkspacePaneRouteTarget } from '#/web/app/navigation/route-model.ts'
import type { AppNavigationActions, AppNavigationOptions } from '#/web/app/navigation/actions.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import { workspacePaneTabTargetForPaneTarget } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { getRepoSnapshotQueryData } from '#/web/repos/query-cache.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import { workspacePaneLocationForBranch } from '#/web/workspace-pane/workspace-pane-location.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneTabModelBranchName,
  workspacePaneTabModelWorkspaceId,
  workspacePaneTabModelWorkspaceRuntimeId,
  workspacePaneTabModelWorktreePath,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'

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
  const target = workspacePaneTabModelForBranchForTest(repoId, branchName)
  const targetBranchName = target ? workspacePaneTabModelBranchName(target) : null
  if (!target || !targetBranchName) return false
  const activeTab = target.activeTab
  const route: ParsedWorkspacePaneRoute | null =
    activeTab?.kind === 'static'
      ? { kind: 'static', tab: activeTab.type }
      : activeTab?.kind === 'runtime' && activeTab.runtimeType === 'terminal'
        ? { kind: 'terminal', terminalSessionId: activeTab.sessionId }
        : null
  observeWorkspacePaneRouteForTest({
    workspaceId: workspacePaneTabModelWorkspaceId(target),
    workspaceRuntimeId: workspacePaneTabModelWorkspaceRuntimeId(target),
    branchName: targetBranchName,
    worktreePath: workspacePaneTabModelWorktreePath(target),
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
    const target = workspacePaneTabModelForBranchForTest(repoId, branchName, route)
    const targetBranchName = target ? workspacePaneTabModelBranchName(target) : null
    if (!target || !targetBranchName) return
    const observation = {
      workspaceId: workspacePaneTabModelWorkspaceId(target),
      workspaceRuntimeId: workspacePaneTabModelWorkspaceRuntimeId(target),
      branchName: targetBranchName,
      worktreePath: workspacePaneTabModelWorktreePath(target),
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
  const { showRepoBranchEmptyWorkspacePane, showRepoBranchWorkspacePaneTab } = navigation
  if (!showRepoBranchEmptyWorkspacePane || !showRepoBranchWorkspacePaneTab) {
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

export function observedFilesystemWorkspacePaneRouteCommitForTest(): AppNavigationActions['commitFilesystemWorkspacePaneRoute'] {
  return vi.fn(async (location, route, commitOptions) => {
    const observation = {
      workspaceId: location.routeTarget.workspaceId,
      workspaceRuntimeId: location.workspaceRuntimeId,
      branchName: '',
      worktreePath: location.routeTarget.kind === 'git-worktree' ? location.routeTarget.worktreePath : null,
    }
    const currentRoute = observedWorkspacePaneRoutes.get(workspacePaneObservationKey(observation))
    const precondition = commitOptions?.routePrecondition
    if (
      (precondition?.kind === 'exact-route' &&
        (currentRoute === undefined || !workspacePaneRoutesEqual(currentRoute, precondition.route))) ||
      (precondition?.kind === 'current-workspace-target' && currentRoute === undefined)
    ) {
      commitOptions?.onAbandon?.()
      return false
    }
    workspacesStore
      .getState()
      .setWorkspacePaneTabForTarget(
        location.routeTarget,
        route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null,
      )
    observeWorkspacePaneRouteForTest({ ...observation, route })
    commitOptions?.onCommit?.()
    return true
  })
}

/** Builds a provider value whose route commit is backed by the test's observed URL projection. */
export function observedAppNavigationActionsForTest(
  overrides: ObservedAppNavigationOverrides,
  options: ObservedWorkspacePaneRouteCommitOptions = {},
): ObservedAppNavigationActionsForTest {
  const { showRepoBranchEmptyWorkspacePane, showRepoBranchWorkspacePaneTab, ...navigationOverrides } = overrides
  const navigation = appNavigationActionsForTest(navigationOverrides)
  const observedNavigation = {
    ...navigation,
    showRepoBranchEmptyWorkspacePane,
    showRepoBranchWorkspacePaneTab,
  }
  const navigationWithFilesystemCommit = overrides.commitFilesystemWorkspacePaneRoute
    ? observedNavigation
    : {
        ...observedNavigation,
        commitFilesystemWorkspacePaneRoute: observedFilesystemWorkspacePaneRouteCommitForTest(),
      }
  if (overrides.commitWorkspacePaneRoute) return navigationWithFilesystemCommit
  return {
    ...navigationWithFilesystemCommit,
    commitWorkspacePaneRoute: vi.fn(
      observedWorkspacePaneRouteCommitForTest(
        { showRepoBranchEmptyWorkspacePane, showRepoBranchWorkspacePaneTab },
        options,
      ),
    ),
  }
}

export function observedWorkspacePaneRouteForTarget(
  repoId: WorkspaceId,
  branchName: string,
): WorkspacePaneRouteTarget | undefined {
  const target = workspacePaneTabModelForBranchForTest(repoId, branchName)
  const targetBranchName = target ? workspacePaneTabModelBranchName(target) : null
  if (!target || !targetBranchName) return undefined
  const route = observedWorkspacePaneRoutes.get(
    workspacePaneObservationKey({
      workspaceId: workspacePaneTabModelWorkspaceId(target),
      workspaceRuntimeId: workspacePaneTabModelWorkspaceRuntimeId(target),
      branchName: targetBranchName,
      worktreePath: workspacePaneTabModelWorktreePath(target),
    }),
  )
  return route?.kind === 'invalid-static' ? undefined : route
}

export function workspacePaneTabModelForBranchForTest(
  workspaceId: WorkspaceId,
  branchName: string,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined = undefined,
) {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return null
  const snapshot = getRepoSnapshotQueryData(workspaceId, workspace.workspaceRuntimeId)
  if (!snapshot) return null
  const worktree = repoWorktreeForBranch(snapshot.worktrees, branchName)
  if (!worktree && !snapshot.branches.some((branch) => branch.name === branchName)) return null
  return workspacePaneTabTargetForPaneTarget({
    location: workspacePaneLocationForBranch(workspaceId, workspace.workspaceRuntimeId, branchName, worktree ?? null),
    workspacePaneRoute,
  })
}

function workspacePaneObservationKey(observation: Omit<WorkspacePaneNavigationObservation, 'route'>): string {
  return [
    observation.workspaceId,
    observation.workspaceRuntimeId,
    observation.worktreePath ? '' : observation.branchName,
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
