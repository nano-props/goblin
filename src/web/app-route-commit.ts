import {
  beginAppNavigation,
  executeAppNavigation,
  appNavigationIsCurrent,
  registerAppNavigation,
  type AppNavigationOutcome,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'
import { navigationLog } from '#/web/logger.ts'

export function runOwnedAppNavigation(input: {
  generation?: AppNavigationGeneration
  targetHref: string
  currentHref: string
  commitEffect?: () => void
  abandonEffect?: () => void
  navigate(navigationGeneration: AppNavigationGeneration): Promise<unknown>
}): boolean {
  const generation = input.generation ?? beginAppNavigation()
  if (input.currentHref === input.targetHref) {
    if (!appNavigationIsCurrent(generation)) {
      input.abandonEffect?.()
      return false
    }
    input.commitEffect?.()
    return true
  }
  const registration = registerAppNavigation(generation, input.targetHref, input.commitEffect, input.abandonEffect)
  if (!registration) {
    input.abandonEffect?.()
    return false
  }
  void registration.settled.then((outcome) => {
    if (outcome.status === 'failed') {
      navigationLog.error('app navigation effect failed', {
        intendedStatus: outcome.intendedStatus,
        error: outcome.error,
      })
    }
  })
  void Promise.resolve()
    .then(async () => await executeAppNavigation(generation, async () => await input.navigate(generation)))
    .finally(() => registration.release())
    .catch((error: unknown) => navigationLog.error('app navigation failed', { error }))
  return true
}

type AppNavigationExecutionOutcome =
  { kind: 'completed'; executed: boolean; routeCommitted: boolean } | { kind: 'failed'; error: unknown }

export async function settleOwnedAppRouteCommit(input: {
  generation?: AppNavigationGeneration
  targetHref: string
  expectedCurrentHref?: string
  commitEffect?: () => void
  abandonEffect?: () => void
  navigate(navigationGeneration: AppNavigationGeneration): Promise<void>
  currentHref(): string
}): Promise<boolean> {
  const generation = input.generation ?? beginAppNavigation()
  const currentHref = input.currentHref()
  if (!appRoutePreconditionMatches(currentHref, input.expectedCurrentHref)) {
    input.abandonEffect?.()
    return false
  }
  if (currentHref === input.targetHref) {
    if (!appNavigationIsCurrent(generation)) {
      input.abandonEffect?.()
      return false
    }
    input.commitEffect?.()
    return true
  }
  const registration = registerAppNavigation(generation, input.targetHref, input.commitEffect, input.abandonEffect)
  if (!registration) {
    input.abandonEffect?.()
    return false
  }
  let routeCommitted = false
  const execution: Promise<AppNavigationExecutionOutcome> = executeAppNavigation(generation, async () => {
    routeCommitted = await settleAppRouteCommit({
      targetHref: input.targetHref,
      expectedCurrentHref: input.expectedCurrentHref,
      navigate: async () => await input.navigate(generation),
      currentHref: input.currentHref,
    })
  }).then(
    (executed) => ({ kind: 'completed', executed, routeCommitted }),
    (error: unknown) => ({ kind: 'failed', error }),
  )
  const first = await Promise.race([
    execution,
    registration.settled.then((settlement) => ({ kind: 'settled' as const, settlement })),
  ])
  if (first.kind === 'settled') {
    void execution.then((outcome) => {
      registration.release()
      if (outcome.kind === 'failed') {
        navigationLog.error('settled app navigation later failed', { error: outcome.error })
      }
    })
    return committedAppNavigationOutcome(first.settlement)
  }
  registration.release()
  if (first.kind === 'failed') throw first.error
  return first.executed && first.routeCommitted && committedAppNavigationOutcome(await registration.settled)
}

function committedAppNavigationOutcome(outcome: AppNavigationOutcome): boolean {
  if (outcome.status === 'failed') throw outcome.error
  return outcome.status === 'committed'
}

export async function settleAppRouteCommit(input: {
  targetHref: string
  expectedCurrentHref?: string
  navigate: () => Promise<void>
  currentHref: () => string
}): Promise<boolean> {
  if (!appRoutePreconditionMatches(input.currentHref(), input.expectedCurrentHref)) return false
  await input.navigate()
  return input.currentHref() === input.targetHref
}

export function appRoutePreconditionMatches(currentHref: string, expectedCurrentHref: string | undefined): boolean {
  return expectedCurrentHref === undefined || currentHref === expectedCurrentHref
}
