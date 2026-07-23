import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import {
  beginPrimaryWindowPresentation,
  currentPrimaryWindowPresentationToken,
  admitPrimaryWindowNavigationWhenUncontested,
  primaryWindowNavigationIsUncontested,
  primaryWindowPresentationIsCurrent,
} from '#/web/primary-window-presentation.ts'
import {
  runWorkspacePaneAction,
  subscribeWorkspacePaneRouteIntents,
  workspacePaneActionTargetFromCoordinates,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  reconcileWorkspacePaneRoute,
  resolveFilesystemWorkspacePaneReplacement,
  type WorkspacePaneRouteReconciliation,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'
import {
  workspacePaneControllerRouteForTab,
  workspacePaneRouteKey,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneControllerTarget,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneModelTargetIdentityKey,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { filesystemWorkspacePaneTargetLeaseForModel } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { claimTerminalPresentationFocus } from '#/web/terminal-focus.ts'
import { navigationLog } from '#/web/logger.ts'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'

export function useFilesystemWorkspacePaneRouteController(input: {
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
}): WorkspacePaneRouteReconciliation {
  const { route, model } = input
  const navigation = usePrimaryWindowNavigation()
  const routeReconciliation = useMemo(() => reconcileWorkspacePaneRoute(route, model), [route, model])
  const replacementResolution = useMemo(
    () => (routeReconciliation.kind === 'missing' ? resolveFilesystemWorkspacePaneReplacement(model) : null),
    [model, routeReconciliation.kind],
  )
  const reconciliation =
    replacementResolution?.kind === 'pending' || replacementResolution?.kind === 'unverified'
      ? replacementResolution
      : routeReconciliation
  const actionTarget = useMemo(
    () =>
      workspacePaneActionTargetFromCoordinates({
        workspaceId: model.workspaceId,
        workspaceRuntimeId: model.workspaceRuntimeId,
        branchName: model.branchName,
        worktreePath: model.worktreePath,
      }),
    [model.branchName, model.workspaceId, model.workspaceRuntimeId, model.worktreePath],
  )
  const routeKey = route?.kind === 'invalid-static' ? null : workspacePaneRouteKey(route)
  const stableRoute = useStableParsedWorkspacePaneRoute(route)
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
  const targetLease = useMemo(() => filesystemWorkspacePaneTargetLeaseForModel(controllerTarget), [controllerTarget])
  const routeIntentPending = useSyncExternalStore(
    subscribeWorkspacePaneRouteIntents,
    () => routeKey !== null && workspacePaneRouteIntentPending(actionTarget, routeKey),
    () => false,
  )
  const effectiveReconciliation =
    routeIntentPending && reconciliation.kind === 'missing' ? ({ kind: 'pending' } as const) : reconciliation
  const replacementRouteCandidate =
    effectiveReconciliation.kind === 'missing' && replacementResolution?.kind === 'resolved'
      ? replacementResolution.replacement
        ? (workspacePaneControllerRouteForTab(replacementResolution.replacement) ?? null)
        : null
      : null
  const replacementStaticTab = replacementRouteCandidate?.kind === 'static' ? replacementRouteCandidate.tab : null
  const replacementTerminalSessionId =
    replacementRouteCandidate?.kind === 'terminal' ? replacementRouteCandidate.terminalSessionId : null
  const replacementRoute = useMemo<WorkspacePaneRouteTarget>(() => {
    if (replacementStaticTab !== null) return { kind: 'static', tab: replacementStaticTab }
    if (replacementTerminalSessionId !== null) {
      return { kind: 'terminal', terminalSessionId: replacementTerminalSessionId }
    }
    return null
  }, [replacementStaticTab, replacementTerminalSessionId])

  useFilesystemWorkspacePaneNavigationHistory({
    route,
    model,
    reconciliation: effectiveReconciliation,
    replacementRoute,
  })
  useSyncWorkspacePaneRuntimeTabSelection(model, { enabled: effectiveReconciliation.kind === 'none' })

  useEffect(() => {
    if (effectiveReconciliation.kind !== 'missing') return
    if (!targetLease) return
    let cancelled = false
    const observedPresentationToken = currentPrimaryWindowPresentationToken()
    let cancelIdleAdmission = () => {}
    const enqueueWhenIdle = () => {
      cancelIdleAdmission()
      cancelIdleAdmission = admitPrimaryWindowNavigationWhenUncontested(() => {
        if (cancelled) return
        void runWorkspacePaneAction(actionTarget, async () => {
          if (cancelled || !workspacePaneTabControllerTargetIsCurrent(controllerTarget)) return
          if (!primaryWindowNavigationIsUncontested()) {
            enqueueWhenIdle()
            return
          }
          if (routeKey !== null && workspacePaneRouteIntentPending(actionTarget, routeKey)) return
          if (
            controllerTarget.paneTarget.kind !== 'workspace-root' &&
            controllerTarget.paneTarget.kind !== 'git-worktree'
          ) {
            return
          }
          if (!primaryWindowPresentationIsCurrent(observedPresentationToken)) return
          const presentationToken = beginPrimaryWindowPresentation()
          const focusEffects =
            replacementRoute?.kind === 'terminal'
              ? claimTerminalPresentationFocus(presentationToken, replacementRoute.terminalSessionId)
              : null
          await navigation.commitFilesystemWorkspacePaneRoute(targetLease, replacementRoute, {
            presentationToken,
            replace: true,
            routePrecondition: { kind: 'exact-route', route: stableRoute },
            onCommit: focusEffects?.onCommit,
            onAbandon: focusEffects?.onAbandon,
          })
        }).catch((error: unknown) => {
          navigationLog.error('filesystem workspace pane route reconciliation failed', { error })
        })
      })
    }
    enqueueWhenIdle()
    return () => {
      cancelled = true
      cancelIdleAdmission()
    }
  }, [
    actionTarget,
    controllerTarget,
    effectiveReconciliation.kind,
    navigation,
    replacementRoute,
    routeKey,
    stableRoute,
    targetLease,
  ])

  return effectiveReconciliation
}

function useFilesystemWorkspacePaneNavigationHistory(input: {
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
  reconciliation: WorkspacePaneRouteReconciliation
  replacementRoute: WorkspacePaneRouteTarget
}): void {
  const { route, model, reconciliation, replacementRoute } = input
  const routeContext =
    reconciliation.kind === 'pending' || reconciliation.kind === 'unverified'
      ? null
      : filesystemWorkspacePaneHistoryRouteContext(
          model,
          reconciliation.kind === 'missing' ? replacementRoute : validWorkspacePaneRoute(route),
        )
  useWorkspaceNavigationHistory({
    routeContext,
    replaceCurrent: reconciliation.kind === 'missing',
    replaceCurrentRouteContext:
      reconciliation.kind === 'missing'
        ? filesystemWorkspacePaneHistoryRouteContext(model, validWorkspacePaneRoute(route))
        : null,
  })
}

function validWorkspacePaneRoute(route: ParsedWorkspacePaneRouteTarget): WorkspacePaneRouteTarget {
  return route?.kind === 'invalid-static' ? null : route
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

function filesystemWorkspacePaneHistoryRouteContext(
  model: WorkspacePaneTabModel,
  workspacePaneRoute: WorkspacePaneRouteTarget,
): WorkspaceNavigationRouteContext | null {
  if (model.routeTarget.kind === 'workspace-root') {
    return {
      kind: 'workspace-root',
      workspaceId: model.workspaceId,
      workspacePaneRoute,
    }
  }
  if (model.routeTarget.kind === 'git-worktree') {
    return {
      kind: 'worktree',
      workspaceId: model.workspaceId,
      worktreePath: model.routeTarget.worktreePath,
      workspacePaneRoute,
    }
  }
  return null
}
