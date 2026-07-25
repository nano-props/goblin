import { useEffect, useEffectEvent, useRef } from 'react'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import {
  abandonRetiredTerminalWorkspacePaneTabPresentationPlan,
  captureRetiredTerminalWorkspacePaneTabPresentationPlan,
  commitRetiredTerminalWorkspacePaneTabPresentationPlan,
  type RetiredTerminalWorkspacePaneTabPresentationPlan,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { terminalLog } from '#/web/logger.ts'
import {
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneFilesystemRuntimeTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { AcceptedTerminalRetirement } from '#/web/components/terminal/TerminalSessionProjection.ts'

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentRouteTarget: WorkspacePaneTabsTarget | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  currentTarget: WorkspacePaneCommandTarget | null
  navigation: PrimaryWindowNavigationActions
}): void {
  const { currentRouteTarget, currentWorkspacePaneRoute, currentTarget, navigation } = input
  const projection = useTerminalSessionProjection()
  const pendingPlanRef = useRef<RetiredTerminalWorkspacePaneTabPresentationPlan | null>(null)

  const settlePendingPlan = useEffectEvent(() => {
    const plan = pendingPlanRef.current
    if (!plan) return
    if (!retiredTerminalPlanStillOwnsCurrentRoute(plan, currentRouteTarget, currentWorkspacePaneRoute)) {
      pendingPlanRef.current = null
      abandonRetiredTerminalWorkspacePaneTabPresentationPlan(plan)
      return
    }
    if (!currentTarget || !retiredTerminalPlanMatchesCommandTarget(plan, currentTarget)) {
      // The plan already owns the complete before-state transition. Hydration
      // is only an admission proof for its captured target; never recompute the
      // destination from the post-retirement projection here.
      return
    }
    pendingPlanRef.current = null
    void commitRetiredTerminalWorkspacePaneTabPresentationPlan(plan, navigation).catch((err: unknown) => {
      terminalLog.warn('failed to present retired terminal close-back', {
        terminalSessionId: plan.terminalSessionId,
        err,
      })
    })
  })

  const handleAcceptedRetirement = useEffectEvent((retirement: AcceptedTerminalRetirement) => {
    if (!currentRouteTarget) return
    const plan = captureRetiredTerminalWorkspacePaneTabPresentationPlan({
      routeTarget: currentRouteTarget,
      workspacePaneRoute: currentWorkspacePaneRoute,
      terminalSessionId: retirement.terminalSessionId,
      terminalBase: retirement.base,
    })
    if (!plan) return
    const previous = pendingPlanRef.current
    pendingPlanRef.current = plan
    if (previous) abandonRetiredTerminalWorkspacePaneTabPresentationPlan(previous)
    settlePendingPlan()
  })

  useEffect(() => {
    const unsubscribe = projection.subscribeAcceptedRetirement(handleAcceptedRetirement)
    return () => {
      unsubscribe()
      const plan = pendingPlanRef.current
      pendingPlanRef.current = null
      if (plan) abandonRetiredTerminalWorkspacePaneTabPresentationPlan(plan)
    }
  }, [projection])

  useEffect(() => settlePendingPlan(), [currentRouteTarget, currentTarget, currentWorkspacePaneRoute, navigation])
}

function retiredTerminalPlanStillOwnsCurrentRoute(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
  currentRouteTarget: WorkspacePaneTabsTarget | null,
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null,
): boolean {
  const capturedRouteTarget = plan.target.routeTarget
  return (
    currentRouteTarget !== null &&
    capturedRouteTarget.kind !== 'inactive' &&
    workspacePaneTabsTargetIdentityKey(currentRouteTarget) ===
      workspacePaneTabsTargetIdentityKey(capturedRouteTarget) &&
    currentWorkspacePaneRoute?.kind === 'terminal' &&
    currentWorkspacePaneRoute.terminalSessionId === plan.terminalSessionId
  )
}

function retiredTerminalPlanMatchesCommandTarget(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
  target: WorkspacePaneCommandTarget,
): boolean {
  const capturedRouteTarget = plan.target.routeTarget
  if (
    capturedRouteTarget.kind === 'inactive' ||
    workspacePaneTabsTargetIdentityKey(target.routeTarget) !== workspacePaneTabsTargetIdentityKey(capturedRouteTarget)
  ) {
    return false
  }
  if (!target.filesystemTarget) return false
  const expectedRuntime = workspacePaneFilesystemRuntimeTarget(target.filesystemTarget)
  const expectedPaneTarget = workspacePaneTabsTargetFromRuntime(expectedRuntime)
  const capturedPaneTarget = plan.target.paneTarget
  return (
    expectedPaneTarget !== null &&
    capturedPaneTarget.kind !== 'inactive' &&
    plan.target.workspaceId === expectedRuntime.workspaceId &&
    plan.target.workspaceRuntimeId === expectedRuntime.workspaceRuntimeId &&
    workspacePaneTabsTargetIdentityKey(capturedPaneTarget) === workspacePaneTabsTargetIdentityKey(expectedPaneTarget)
  )
}
