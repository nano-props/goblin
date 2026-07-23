import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { usePrimaryWindowNavigation, type PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneModelTargetIdentityKey,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'
import {
  commitWorkspacePaneExactTargetRoute,
  workspacePaneRouteKey,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneControllerTarget,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  subscribeWorkspacePaneRouteIntents,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  beginPrimaryWindowPresentation,
  currentPrimaryWindowPresentationToken,
  admitPrimaryWindowNavigationWhenUncontested,
  primaryWindowNavigationIsUncontested,
  primaryWindowPresentationIsCurrent,
} from '#/web/primary-window-presentation.ts'
import { navigationLog } from '#/web/logger.ts'

export interface GitWorkspacePaneRouteControllerInput {
  enabled?: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
}

// Single side-effect boundary for URL-backed workspace-pane routes.
// Data flows from server/projection model -> route reconciliation -> app
// history -> validated preference sync -> canonical route replacement.
// Keep this ordering intact so browser Back/Forward metadata is consumed
// before a stale URL is replaced.
export function useGitWorkspacePaneRouteController({
  enabled = true,
  workspaceId,
  branchName,
  worktreePath,
  route,
  model,
}: GitWorkspacePaneRouteControllerInput): WorkspacePaneRouteReconciliation {
  const navigation = usePrimaryWindowNavigation()
  const reconciliation = useMemo(
    () => (enabled ? reconcileWorkspacePaneRoute(route, model) : { kind: 'none' as const }),
    [enabled, route, model],
  )
  const actionTarget = useMemo(
    () =>
      workspacePaneActionTargetFromCoordinates({
        workspaceId,
        workspaceRuntimeId: model.workspaceRuntimeId,
        branchName,
        worktreePath,
      }),
    [branchName, model.workspaceRuntimeId, workspaceId, worktreePath],
  )
  const routeKey = route?.kind === 'invalid-static' ? null : workspacePaneRouteKey(route)
  const stableRoute = useStableParsedWorkspacePaneRoute(route)
  const routeIntentPending = useSyncExternalStore(
    subscribeWorkspacePaneRouteIntents,
    () => routeKey !== null && workspacePaneRouteIntentPending(actionTarget, routeKey),
    () => false,
  )
  const effectiveReconciliation =
    routeIntentPending && reconciliation.kind === 'missing' ? ({ kind: 'pending' } as const) : reconciliation
  const routeTargetKey = workspacePaneModelTargetIdentityKey(model.routeTarget)
  const paneTargetKey = workspacePaneModelTargetIdentityKey(model.paneTarget)
  const controllerTarget = useMemo<WorkspacePaneControllerTarget>(
    () => ({
      workspaceId: model.workspaceId,
      workspaceRuntimeId: model.workspaceRuntimeId,
      routeTarget: model.routeTarget,
      branchName: model.branchName,
      worktreePath: model.worktreePath,
      paneTarget: model.paneTarget,
    }),
    [model.branchName, model.workspaceId, model.workspaceRuntimeId, model.worktreePath, paneTargetKey, routeTargetKey],
  )

  useWorkspacePaneNavigationHistory({
    enabled,
    workspaceId,
    branchName,
    worktreePath,
    route: stableRoute,
    reconciliation: effectiveReconciliation,
  })
  useSyncRoutedWorkspacePaneSelection({
    enabled,
    workspaceId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })
  useSyncWorkspacePaneRuntimeTabSelection(model, { enabled: enabled && reconciliation.kind === 'none' })
  useReconcileWorkspacePaneRoute({
    enabled,
    branchName,
    actionTarget,
    target: controllerTarget,
    route: stableRoute,
    routeKey,
    reconciliationKind: reconciliation.kind,
    routeIntentPending,
    navigation,
  })

  return effectiveReconciliation
}

function useReconcileWorkspacePaneRoute({
  enabled,
  branchName,
  actionTarget,
  target,
  route,
  routeKey,
  reconciliationKind,
  routeIntentPending,
  navigation,
}: {
  enabled: boolean
  branchName: string | null
  actionTarget: ReturnType<typeof workspacePaneActionTargetFromCoordinates>
  target: WorkspacePaneControllerTarget
  route: ParsedWorkspacePaneRouteTarget
  routeKey: string | null
  reconciliationKind: WorkspacePaneRouteReconciliation['kind']
  routeIntentPending: boolean
  navigation: PrimaryWindowNavigationActions
}): void {
  useEffect(() => {
    if (!enabled || reconciliationKind !== 'missing' || !branchName) return
    let cancelled = false
    const observedPresentationToken = currentPrimaryWindowPresentationToken()
    let cancelIdleAdmission = () => {}
    const enqueueWhenIdle = () => {
      cancelIdleAdmission()
      cancelIdleAdmission = admitPrimaryWindowNavigationWhenUncontested(() => {
        if (cancelled) return
        void runWorkspacePaneAction(actionTarget, async () => {
          if (cancelled || !workspacePaneTabControllerTargetIsCurrent(target)) return
          if (!primaryWindowNavigationIsUncontested()) {
            enqueueWhenIdle()
            return
          }
          if (routeIntentPending || (routeKey !== null && workspacePaneRouteIntentPending(actionTarget, routeKey)))
            return
          if (!primaryWindowPresentationIsCurrent(observedPresentationToken)) return
          const presentationToken = beginPrimaryWindowPresentation()
          await commitWorkspacePaneExactTargetRoute(
            target,
            route,
            null,
            navigation,
            { replace: true },
            presentationToken,
          )
        }).catch((error: unknown) => {
          navigationLog.error('git workspace pane route reconciliation failed', { error })
        })
      })
    }
    enqueueWhenIdle()
    return () => {
      cancelled = true
      cancelIdleAdmission()
    }
  }, [actionTarget, branchName, enabled, navigation, reconciliationKind, route, routeKey, routeIntentPending, target])
}

function useWorkspacePaneNavigationHistory({
  enabled,
  workspaceId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const historyRoute = workspacePaneRouteHistoryResolution(route ?? null, reconciliation)
  const replaceCurrentRoute = workspacePaneValidRouteTarget(route)
  const replaceCurrentRouteContext =
    branchName && reconciliation.kind === 'missing'
      ? workspacePaneHistoryRouteContext({
          workspaceId,
          branchName,
          worktreePath,
          route: replaceCurrentRoute,
        })
      : null
  useWorkspaceNavigationHistory({
    replaceCurrent: reconciliation.kind === 'missing',
    replaceCurrentRouteContext,
    routeContext:
      enabled && branchName && historyRoute.kind === 'record'
        ? workspacePaneHistoryRouteContext({ workspaceId, branchName, worktreePath, route: historyRoute.route })
        : null,
  })
}

function useStableParsedWorkspacePaneRoute(route: ParsedWorkspacePaneRouteTarget): ParsedWorkspacePaneRouteTarget {
  const staticTab = route?.kind === 'static' ? route.tab : null
  const terminalSessionId = route?.kind === 'terminal' ? route.terminalSessionId : null
  const invalidStaticTabKey = route?.kind === 'invalid-static' ? route.tabKey : null
  return useMemo(() => {
    if (staticTab !== null) return { kind: 'static', tab: staticTab }
    if (terminalSessionId !== null) return { kind: 'terminal', terminalSessionId }
    if (invalidStaticTabKey !== null) return { kind: 'invalid-static', tabKey: invalidStaticTabKey }
    return null
  }, [invalidStaticTabKey, staticTab, terminalSessionId])
}

function workspacePaneValidRouteTarget(route: ParsedWorkspacePaneRouteTarget): WorkspacePaneRouteTarget {
  if (route?.kind === 'invalid-static') return null
  return route
}

function workspacePaneHistoryRouteContext({
  workspaceId,
  branchName,
  worktreePath,
  route,
}: {
  workspaceId: WorkspaceId
  branchName: string
  worktreePath: string | null
  route: WorkspacePaneRouteTarget
}): WorkspaceNavigationRouteContext {
  return {
    kind: 'branch',
    workspaceId,
    branchName,
    worktreePath,
    workspacePaneRoute: route,
  }
}

function useSyncRoutedWorkspacePaneSelection({
  enabled,
  workspaceId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const setWorkspacePaneTab = useWorkspacesStore((s) => s.setWorkspacePaneTab)
  useEffect(() => {
    if (!enabled) return
    if (!branchName) return
    if (reconciliation.kind !== 'none') return
    const state = useWorkspacesStore.getState()
    const repo = state.workspaces[workspaceId]
    if (!repo) return
    const target = requiredGitWorkspacePaneTabsTarget(workspaceId, branchName, worktreePath)
    if (route?.kind === 'invalid-static') return
    const routeTab = route === null ? null : route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
      setWorkspacePaneTab(workspaceId, branchName, routeTab)
    }
  }, [branchName, enabled, reconciliation.kind, workspaceId, route, setWorkspacePaneTab, worktreePath])
}
