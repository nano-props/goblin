import { useCallback, useEffect, useRef } from 'react'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import {
  abandonRetiredTerminalWorkspacePaneTabPresentationCommand,
  captureRetiredTerminalWorkspacePaneTabPresentationCommand,
  commitRetiredTerminalWorkspacePaneTabPresentationCommand,
  retiredTerminalWorkspacePaneTabPresentationPlanMatchesCommandTarget,
} from '#/web/commands/workspace-commands.ts'
import { terminalLog } from '#/web/logger.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { RetiredTerminalWorkspacePaneTabPresentationPlan } from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentRouteTarget: WorkspacePaneTabsTarget | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  currentTarget: WorkspacePaneCommandTarget | null
  navigation: PrimaryWindowNavigationActions
}): void {
  const { currentRouteTarget, currentWorkspacePaneRoute, currentTarget, navigation } = input
  const projection = useTerminalSessionProjection()
  const pendingPlanRef = useRef<RetiredTerminalWorkspacePaneTabPresentationPlan | null>(null)
  const currentInputRef = useRef(input)
  currentInputRef.current = input

  const replacePendingPlan = useCallback((plan: RetiredTerminalWorkspacePaneTabPresentationPlan | null) => {
    const previous = pendingPlanRef.current
    pendingPlanRef.current = plan
    if (previous && previous !== plan) abandonRetiredTerminalWorkspacePaneTabPresentationCommand(previous)
  }, [])

  const settlePendingPlan = useCallback(() => {
    const plan = pendingPlanRef.current
    if (!plan) return
    const current = currentInputRef.current
    if (
      !retiredTerminalPlanStillOwnsCurrentRoute(plan, current.currentRouteTarget, current.currentWorkspacePaneRoute)
    ) {
      replacePendingPlan(null)
      return
    }
    if (
      !current.currentTarget ||
      !retiredTerminalWorkspacePaneTabPresentationPlanMatchesCommandTarget(plan, current.currentTarget)
    ) {
      // The plan already owns the complete before-state transition. Hydration
      // is only an admission proof for its captured target; never recompute the
      // destination from the post-retirement projection here.
      return
    }
    pendingPlanRef.current = null
    void commitRetiredTerminalWorkspacePaneTabPresentationCommand(plan, current.navigation).catch((err: unknown) => {
      terminalLog.warn('failed to present retired terminal close-back', {
        terminalSessionId: plan.terminalSessionId,
        err,
      })
    })
  }, [replacePendingPlan])

  useEffect(
    () =>
      projection.subscribeAcceptedRetirement((retirement) => {
        const current = currentInputRef.current
        if (!current.currentRouteTarget) return
        const plan = captureRetiredTerminalWorkspacePaneTabPresentationCommand({
          routeTarget: current.currentRouteTarget,
          workspacePaneRoute: current.currentWorkspacePaneRoute,
          terminalSessionId: retirement.terminalSessionId,
          terminalBase: retirement.base,
        })
        if (!plan) return
        replacePendingPlan(plan)
        settlePendingPlan()
      }),
    [projection, replacePendingPlan, settlePendingPlan],
  )

  useEffect(settlePendingPlan, [
    currentRouteTarget,
    currentTarget,
    currentWorkspacePaneRoute,
    navigation,
    settlePendingPlan,
  ])

  useEffect(
    () => () => {
      const plan = pendingPlanRef.current
      pendingPlanRef.current = null
      if (plan) abandonRetiredTerminalWorkspacePaneTabPresentationCommand(plan)
    },
    [],
  )
}

function retiredTerminalPlanStillOwnsCurrentRoute(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
  currentRouteTarget: WorkspacePaneTabsTarget | null,
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null,
): boolean {
  return (
    currentRouteTarget !== null &&
    workspacePaneTabsTargetIdentityKey(currentRouteTarget) === workspacePaneTabsTargetIdentityKey(plan.routeTarget) &&
    currentWorkspacePaneRoute?.kind === 'terminal' &&
    currentWorkspacePaneRoute.terminalSessionId === plan.terminalSessionId
  )
}
