import type { HistoryState } from '@tanstack/history'

declare module '@tanstack/history' {
  interface HistoryState {
    __goblinAppNavigationGeneration?: number
  }
}

export type AppNavigationGeneration = number

export const APP_NAVIGATION_STATE_KEY = '__goblinAppNavigationGeneration' as const

interface AppOwnedNavigation {
  generation: AppNavigationGeneration
  targetHref: string
  commitEffect?: () => void
  abandonEffect?: () => void
  resolveSettlement: (outcome: AppNavigationOutcome) => void
}

export type AppNavigationOutcome =
  | { status: 'committed' }
  | { status: 'abandoned' }
  | { status: 'failed'; intendedStatus: 'committed' | 'abandoned'; error: unknown }

export interface AppNavigationRegistration {
  settled: Promise<AppNavigationOutcome>
  release(): void
}

let latestAppNavigationGeneration = 0
let ownedAppNavigation: AppOwnedNavigation | null = null

export function beginAppNavigation(): AppNavigationGeneration {
  latestAppNavigationGeneration += 1
  const generation = latestAppNavigationGeneration
  const superseded = takeOwnedAppNavigation()
  if (superseded) settleAppNavigationEffect(superseded, 'abandoned')
  return generation
}

export function appNavigationIsCurrent(generation: AppNavigationGeneration): boolean {
  return generation === latestAppNavigationGeneration
}

export function currentAppNavigationGeneration(): AppNavigationGeneration {
  return latestAppNavigationGeneration
}

/**
 * Captures the current generation only when no history commit is registered
 * against it. The caller may use that generation for a passive transition
 * without displacing the registered commit owner. A later navigation still
 * invalidates the captured generation through the normal currentness check.
 *
 * This deliberately does not coordinate the brief interval between a user
 * action choosing a generation and registering its history commit. Terminal
 * close-back is best-effort presentation: a rare overlap may produce a
 * retryable navigation race, while runtime and tab authority remain intact.
 * Modeling admission across every async action would add lifecycle state and
 * release paths disproportionate to that recoverable UI-only risk.
 */
export function captureUnownedAppNavigationGeneration(): AppNavigationGeneration | null {
  return ownedAppNavigation ? null : latestAppNavigationGeneration
}

export async function executeAppNavigation(
  generation: AppNavigationGeneration,
  navigate: () => Promise<unknown>,
): Promise<boolean> {
  if (!appNavigationIsCurrent(generation)) return false
  await navigate()
  return appNavigationIsCurrent(generation)
}

export function registerAppNavigation(
  generation: AppNavigationGeneration,
  targetHref: string,
  commitEffect?: () => void,
  abandonEffect?: () => void,
): AppNavigationRegistration | null {
  if (!appNavigationIsCurrent(generation)) return null
  if (ownedAppNavigation) {
    throw new Error('app navigation generation already owns a history commit')
  }
  const settlement = Promise.withResolvers<AppNavigationOutcome>()
  const owned: AppOwnedNavigation = {
    generation,
    targetHref,
    commitEffect,
    abandonEffect,
    resolveSettlement: settlement.resolve,
  }
  ownedAppNavigation = owned
  return {
    settled: settlement.promise,
    release() {
      if (ownedAppNavigation !== owned) return
      ownedAppNavigation = null
      settleAppNavigationEffect(owned, 'abandoned')
    },
  }
}

export function appNavigationState(state: HistoryState, generation: AppNavigationGeneration): HistoryState {
  return { ...state, [APP_NAVIGATION_STATE_KEY]: generation }
}

export function observeAppHistoryNavigation(input: {
  href: string
  state: HistoryState | undefined
  action: { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }
}): void {
  if (input.action.type === 'BACK' || input.action.type === 'FORWARD' || input.action.type === 'GO') {
    beginAppNavigation()
    return
  }
  const generation = input.state?.[APP_NAVIGATION_STATE_KEY]
  const owned = generation === undefined ? null : takeOwnedAppNavigation(generation)
  if (owned) {
    if (owned.targetHref === input.href && appNavigationIsCurrent(owned.generation)) {
      settleAppNavigationEffect(owned, 'committed')
      return
    }
    // The browser location has already changed. Advance navigation ownership
    // before settling the superseded effect.
    beginAppNavigation()
    settleAppNavigationEffect(owned, 'abandoned')
    return
  }
  beginAppNavigation()
}

function takeOwnedAppNavigation(generation?: AppNavigationGeneration): AppOwnedNavigation | null {
  const owned = ownedAppNavigation
  if (!owned || (generation !== undefined && owned.generation !== generation)) return null
  ownedAppNavigation = null
  return owned
}

function settleAppNavigationEffect(owned: AppOwnedNavigation, settlement: 'committed' | 'abandoned'): void {
  try {
    if (settlement === 'committed') owned.commitEffect?.()
    else owned.abandonEffect?.()
    owned.resolveSettlement({ status: settlement })
  } catch (error) {
    owned.resolveSettlement({ status: 'failed', intendedStatus: settlement, error })
  }
}

export function resetAppNavigationForTest(): void {
  latestAppNavigationGeneration = 0
  ownedAppNavigation = null
}
