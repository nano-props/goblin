import { useEffect, useEffectEvent, useRef } from 'react'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import {
  captureRetiredTerminalWorkspacePaneTabPresentationPlan,
  commitRetiredTerminalWorkspacePaneTabPresentationPlan,
  settleRetiredTerminalWorkspacePaneTabPresentationPlan,
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
import { useWorkspacePaneTabsProjectionVersion } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

interface PendingRetiredTerminalPresentation {
  retirement: AcceptedTerminalRetirement
  phase:
    | { kind: 'awaiting-target' }
    | { kind: 'ready'; plan: RetiredTerminalWorkspacePaneTabPresentationPlan }
    | { kind: 'awaiting-authority'; plan: RetiredTerminalWorkspacePaneTabPresentationPlan }
    | {
        kind: 'waiting-for-intent'
        plan: RetiredTerminalWorkspacePaneTabPresentationPlan
        settled: Promise<PrimaryWindowNavigationOutcome>
      }
    | {
        kind: 'committing'
        plan: RetiredTerminalWorkspacePaneTabPresentationPlan
        intent: PrimaryWindowNavigationIntent
      }
    | {
        kind: 'waiting-for-settlement'
        plan: RetiredTerminalWorkspacePaneTabPresentationPlan
        intent: PrimaryWindowNavigationIntent
      }
  invalidationListener: () => void
}

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentRouteTarget: WorkspacePaneTabsTarget | null
  currentRouteAuthority: 'ready' | 'pending' | 'stale'
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  navigation: PrimaryWindowNavigationActions
}): void {
  const { currentRouteTarget, currentRouteAuthority, currentWorkspacePaneRoute, navigation } = input
  const projection = useTerminalSessionProjection()
  const workspacePaneTabsProjectionVersion = useWorkspacePaneTabsProjectionVersion()
  const pendingRef = useRef<PendingRetiredTerminalPresentation | null>(null)

  const finishPending = useEffectEvent(
    (pending: PendingRetiredTerminalPresentation, disposition: 'settle' | 'release' | 'invalidate') => {
      if (pendingRef.current === pending) pendingRef.current = null
      pending.retirement.invalidationSignal.removeEventListener('abort', pending.invalidationListener)
      if (pending.phase.kind === 'committing') pending.phase.intent.release()
      if (disposition === 'release') pending.retirement.release()
      else if (disposition === 'settle') {
        const plan = pendingPresentationPlan(pending)
        if (plan) settleRetiredTerminalWorkspacePaneTabPresentationPlan(plan)
        pending.retirement.settle()
      }
    },
  )

  const attemptPending = useEffectEvent(() => {
    const pending = pendingRef.current
    if (!pending) return
    if (pending.phase.kind === 'waiting-for-intent') {
      if (
        !retiredTerminalPlanStillOwnsCurrentRoute(pending.phase.plan, currentRouteTarget, currentWorkspacePaneRoute)
      ) {
        finishPending(pending, 'settle')
      } else if (currentRouteAuthority === 'stale') {
        finishPending(pending, 'settle')
      }
      return
    }
    let plan: RetiredTerminalWorkspacePaneTabPresentationPlan
    if (pending.phase.kind === 'awaiting-target') {
      if (
        currentWorkspacePaneRoute?.kind !== 'terminal' ||
        currentWorkspacePaneRoute.terminalSessionId !== pending.retirement.terminalSessionId
      ) {
        finishPending(pending, 'settle')
        return
      }
      if (currentRouteAuthority === 'stale') {
        finishPending(pending, 'settle')
        return
      }
      if (!currentRouteTarget) return
      const captured = captureRetiredTerminalWorkspacePaneTabPresentationPlan({
        routeTarget: currentRouteTarget,
        workspacePaneRoute: currentWorkspacePaneRoute,
        terminalSessionId: pending.retirement.terminalSessionId,
        terminalBase: pending.retirement.base,
        retirementPresentation: pending.retirement.retirementPresentation,
      })
      if (!captured) {
        finishPending(pending, 'settle')
        return
      }
      pending.phase = { kind: 'ready', plan: captured }
      plan = captured
    } else if (pending.phase.kind === 'ready' || pending.phase.kind === 'awaiting-authority') {
      plan = pending.phase.plan
    } else {
      return
    }
    if (!retiredTerminalPlanStillOwnsCurrentRoute(plan, currentRouteTarget, currentWorkspacePaneRoute)) {
      finishPending(pending, 'settle')
      return
    }
    if (currentRouteAuthority === 'stale') {
      finishPending(pending, 'settle')
      return
    }
    if (currentRouteAuthority === 'pending') {
      pending.phase = { kind: 'awaiting-authority', plan }
      return
    }
    const admission = tryBeginPassivePrimaryWindowNavigationIntent()
    if (admission.kind === 'occupied') {
      const waitingPhase = { kind: 'waiting-for-intent' as const, plan, settled: admission.settled }
      pending.phase = waitingPhase
      void admission.settled.then(() => {
        if (pendingRef.current !== pending || pending.phase !== waitingPhase) return
        pending.phase = { kind: 'ready', plan }
        attemptPending()
      })
      return
    }
    const intent = admission.intent
    const committingPhase = { kind: 'committing' as const, plan, intent }
    pending.phase = committingPhase
    void commitRetiredTerminalWorkspacePaneTabPresentationPlan(plan, navigation, intent)
      .then(async (commitOutcome) => {
        intent.release()
        const settlementPhase = { kind: 'waiting-for-settlement' as const, plan, intent }
        if (pendingRef.current === pending && pending.phase === committingPhase) pending.phase = settlementPhase
        const outcome = await intent.settled
        if (pendingRef.current !== pending || pending.phase !== settlementPhase) return
        if (commitOutcome.kind === 'committed' && outcome.status === 'committed') {
          finishPending(pending, 'settle')
          return
        }
        if (commitOutcome.kind === 'pending') {
          if (!retiredTerminalPlanStillOwnsCurrentRoute(plan, currentRouteTarget, currentWorkspacePaneRoute)) {
            finishPending(pending, 'settle')
            return
          }
          pending.phase = { kind: 'awaiting-authority', plan }
          return
        }
        if (commitOutcome.kind === 'retry') {
          if (!retiredTerminalPlanStillOwnsCurrentRoute(plan, currentRouteTarget, currentWorkspacePaneRoute)) {
            finishPending(pending, 'settle')
            return
          }
          pending.phase = { kind: 'ready', plan }
          attemptPending()
          return
        }
        if (outcome.status === 'superseded') {
          pending.phase = { kind: 'ready', plan }
          attemptPending()
          return
        }
        finishPending(pending, 'settle')
      })
      .catch((err: unknown) => {
        const settlementPhase = { kind: 'waiting-for-settlement' as const, plan, intent }
        if (pendingRef.current === pending && pending.phase === committingPhase) pending.phase = settlementPhase
        intent.fail(err)
        if (pendingRef.current === pending && pending.phase === settlementPhase) finishPending(pending, 'settle')
        terminalLog.warn('failed to present retired terminal close-back', {
          terminalSessionId: pending.retirement.terminalSessionId,
          err,
        })
      })
  })

  const handleAcceptedRetirement = useEffectEvent((retirement: AcceptedTerminalRetirement) => {
    let pending: PendingRetiredTerminalPresentation
    const invalidationListener = () => {
      if (pendingRef.current === pending) finishPending(pending, 'invalidate')
    }
    pending = { retirement, phase: { kind: 'awaiting-target' }, invalidationListener }
    pendingRef.current = pending
    retirement.invalidationSignal.addEventListener('abort', invalidationListener, { once: true })
    attemptPending()
  })

  useEffect(() => {
    const unsubscribe = projection.subscribeAcceptedRetirement(handleAcceptedRetirement)
    return () => {
      unsubscribe()
      const pending = pendingRef.current
      if (pending) finishPending(pending, 'release')
    }
  }, [projection])

  useEffect(
    () => attemptPending(),
    [
      currentRouteTarget,
      currentRouteAuthority,
      currentWorkspacePaneRoute,
      navigation,
      workspacePaneTabsProjectionVersion,
    ],
  )
}

function pendingPresentationPlan(
  pending: PendingRetiredTerminalPresentation,
): RetiredTerminalWorkspacePaneTabPresentationPlan | null {
  return pending.phase.kind === 'awaiting-target' ? null : pending.phase.plan
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
