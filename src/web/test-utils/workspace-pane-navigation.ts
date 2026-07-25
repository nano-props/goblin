import { afterEach, vi } from 'vitest'
import type { ParsedWorkspacePaneRoute, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type {
  PrimaryWindowNavigationActions,
  PrimaryWindowNavigationOptions,
} from '#/web/primary-window-navigation-actions.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { primaryWindowNavigationActionsForTest } from '#/web/test-utils/primary-window-navigation.ts'

export interface ObservedBranchRouteNavigationForTest {
  showRepoBranchEmptyWorkspacePane: (
    workspaceId: WorkspaceId,
    branchName: string,
    options?: PrimaryWindowNavigationOptions,
  ) => boolean
  showRepoBranchWorkspacePaneTab: (
    workspaceId: WorkspaceId,
    branchName: string,
    tab: Extract<WorkspacePaneRouteTarget, { kind: 'static' }>['tab'],
    options?: PrimaryWindowNavigationOptions,
  ) => boolean
  showRepoBranchTerminalSession: (
    workspaceId: WorkspaceId,
    branchName: string,
    terminalSessionId: string,
    options?: PrimaryWindowNavigationOptions,
  ) => boolean
}

type ObservedPrimaryWindowNavigationOverrides = Partial<PrimaryWindowNavigationActions> &
  ObservedBranchRouteNavigationForTest
export type PrimaryWindowNavigationOverridesForTest = Partial<PrimaryWindowNavigationActions> &
  Partial<ObservedBranchRouteNavigationForTest>
export type ObservedPrimaryWindowNavigationActionsForTest = PrimaryWindowNavigationActions &
  ObservedBranchRouteNavigationForTest

export interface ObservedWorkspacePaneRouteCommitOptions {
  observeAcceptedRoute?: (observation: WorkspacePaneNavigationObservation) => void
  commitRoute?: PrimaryWindowNavigationActions['commitWorkspacePaneRoute']
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
  const state = useWorkspacesStore.getState()
  const repoId = state.restoredWorkspaceId
  const repo = repoId ? state.workspaces[repoId] : null
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
): PrimaryWindowNavigationActions['commitWorkspacePaneRoute'] {
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
  const abandonCommit = (commitOptions: PrimaryWindowNavigationOptions | undefined) => {
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
export function observedPrimaryWindowNavigationActionsForTest(
  overrides: ObservedPrimaryWindowNavigationOverrides,
  options: ObservedWorkspacePaneRouteCommitOptions = {},
): ObservedPrimaryWindowNavigationActionsForTest {
  const {
    showRepoBranchEmptyWorkspacePane,
    showRepoBranchWorkspacePaneTab,
    showRepoBranchTerminalSession,
    ...navigationOverrides
  } = overrides
  const navigation = primaryWindowNavigationActionsForTest(navigationOverrides)
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
