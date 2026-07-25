import { useEffect, useEffectEvent, useRef } from 'react'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import {
  captureRetiredTerminalWorkspacePaneTabPresentationPlan,
  commitRetiredTerminalWorkspacePaneTabPresentationPlan,
  type RetiredTerminalWorkspacePaneTabPresentationPlan,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { terminalLog } from '#/web/logger.ts'
import {
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { AcceptedTerminalRetirement } from '#/web/components/terminal/TerminalSessionProjection.ts'
import {
  tryBeginPassivePrimaryWindowNavigationIntent,
  type PrimaryWindowNavigationIntent,
  type PrimaryWindowNavigationOutcome,
} from '#/web/primary-window-navigation-lifecycle.ts'

interface PendingRetiredTerminalPresentation {
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan
  intent: PrimaryWindowNavigationIntent | null
  waitingOn: Promise<PrimaryWindowNavigationOutcome> | null
}

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentRouteTarget: WorkspacePaneTabsTarget | null
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  navigation: PrimaryWindowNavigationActions
}): void {
  const { currentRouteTarget, currentWorkspacePaneRoute, navigation } = input
  const projection = useTerminalSessionProjection()
  const pendingRef = useRef<PendingRetiredTerminalPresentation | null>(null)

  const abandonPending = useEffectEvent((pending: PendingRetiredTerminalPresentation) => {
    if (pendingRef.current === pending) pendingRef.current = null
    pending.intent?.release()
  })

  const attemptPending = useEffectEvent(() => {
    const pending = pendingRef.current
    if (!pending) return
    if (!retiredTerminalPlanStillOwnsCurrentRoute(pending.plan, currentRouteTarget, currentWorkspacePaneRoute)) {
      abandonPending(pending)
      return
    }
    if (pending.intent || pending.waitingOn) return
    const admission = tryBeginPassivePrimaryWindowNavigationIntent()
    if (admission.kind === 'occupied') {
      pending.waitingOn = admission.settled
      void admission.settled.then(() => {
        if (pendingRef.current !== pending || pending.waitingOn !== admission.settled) return
        pending.waitingOn = null
        attemptPending()
      })
      return
    }
    const intent = admission.intent
    pending.intent = intent
    void commitRetiredTerminalWorkspacePaneTabPresentationPlan(pending.plan, navigation, intent)
      .then(async (committed) => {
        intent.release()
        const outcome = await intent.settled
        if (pendingRef.current !== pending || pending.intent !== intent) return
        pending.intent = null
        if (committed && outcome.status === 'committed') {
          pendingRef.current = null
          return
        }
        if (outcome.status === 'superseded') {
          attemptPending()
          return
        }
        abandonPending(pending)
      })
      .catch((err: unknown) => {
        intent.fail(err)
        if (pendingRef.current === pending && pending.intent === intent) abandonPending(pending)
        terminalLog.warn('failed to present retired terminal close-back', {
          terminalSessionId: pending.plan.terminalSessionId,
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
      retirementPresentation: retirement.retirementPresentation,
    })
    if (!plan) return
    const previous = pendingRef.current
    if (previous) abandonPending(previous)
    pendingRef.current = { plan, intent: null, waitingOn: null }
    attemptPending()
  })

  useEffect(() => {
    const unsubscribe = projection.subscribeAcceptedRetirement(handleAcceptedRetirement)
    return () => {
      unsubscribe()
      const pending = pendingRef.current
      if (pending) abandonPending(pending)
    }
  }, [projection])

  useEffect(() => attemptPending(), [currentRouteTarget, currentWorkspacePaneRoute, navigation])
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
