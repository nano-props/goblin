import type { HistoryState } from '@tanstack/history'

declare module '@tanstack/history' {
  interface HistoryState {
    __goblinPrimaryWindowNavigationGeneration?: number
  }
}

export type PrimaryWindowNavigationGeneration = number

export const PRIMARY_WINDOW_NAVIGATION_STATE_KEY = '__goblinPrimaryWindowNavigationGeneration' as const

interface PrimaryWindowOwnedNavigation {
  generation: PrimaryWindowNavigationGeneration
  targetHref: string
  commitEffect?: () => void
  abandonEffect?: () => void
  resolveSettlement: (outcome: PrimaryWindowNavigationOutcome) => void
}

export type PrimaryWindowNavigationOutcome =
  | { status: 'committed' }
  | { status: 'abandoned' }
  | { status: 'failed'; intendedStatus: 'committed' | 'abandoned'; error: unknown }

export interface PrimaryWindowNavigationRegistration {
  settled: Promise<PrimaryWindowNavigationOutcome>
  release(): void
}

let latestPrimaryWindowNavigationGeneration = 0
let ownedPrimaryWindowNavigation: PrimaryWindowOwnedNavigation | null = null

export function beginPrimaryWindowNavigation(): PrimaryWindowNavigationGeneration {
  latestPrimaryWindowNavigationGeneration += 1
  const generation = latestPrimaryWindowNavigationGeneration
  const superseded = takeOwnedPrimaryWindowNavigation()
  if (superseded) settlePrimaryWindowNavigationEffect(superseded, 'abandoned')
  return generation
}

export function primaryWindowNavigationIsCurrent(generation: PrimaryWindowNavigationGeneration): boolean {
  return generation === latestPrimaryWindowNavigationGeneration
}

export function currentPrimaryWindowNavigationGeneration(): PrimaryWindowNavigationGeneration {
  return latestPrimaryWindowNavigationGeneration
}

export async function executePrimaryWindowNavigation(
  generation: PrimaryWindowNavigationGeneration,
  navigate: () => Promise<unknown>,
): Promise<boolean> {
  if (!primaryWindowNavigationIsCurrent(generation)) return false
  await navigate()
  return primaryWindowNavigationIsCurrent(generation)
}

export function registerPrimaryWindowNavigation(
  generation: PrimaryWindowNavigationGeneration,
  targetHref: string,
  commitEffect?: () => void,
  abandonEffect?: () => void,
): PrimaryWindowNavigationRegistration | null {
  if (!primaryWindowNavigationIsCurrent(generation)) return null
  if (ownedPrimaryWindowNavigation) {
    throw new Error('primary window navigation generation already owns a history commit')
  }
  const settlement = Promise.withResolvers<PrimaryWindowNavigationOutcome>()
  const owned: PrimaryWindowOwnedNavigation = {
    generation,
    targetHref,
    commitEffect,
    abandonEffect,
    resolveSettlement: settlement.resolve,
  }
  ownedPrimaryWindowNavigation = owned
  return {
    settled: settlement.promise,
    release() {
      if (ownedPrimaryWindowNavigation !== owned) return
      ownedPrimaryWindowNavigation = null
      settlePrimaryWindowNavigationEffect(owned, 'abandoned')
    },
  }
}

export function primaryWindowNavigationState(
  state: HistoryState,
  generation: PrimaryWindowNavigationGeneration,
): HistoryState {
  return { ...state, [PRIMARY_WINDOW_NAVIGATION_STATE_KEY]: generation }
}

export function observePrimaryWindowHistoryNavigation(input: {
  href: string
  state: HistoryState | undefined
  action: { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }
}): void {
  if (input.action.type === 'BACK' || input.action.type === 'FORWARD' || input.action.type === 'GO') {
    beginPrimaryWindowNavigation()
    return
  }
  const generation = input.state?.[PRIMARY_WINDOW_NAVIGATION_STATE_KEY]
  const owned = generation === undefined ? null : takeOwnedPrimaryWindowNavigation(generation)
  if (owned) {
    if (owned.targetHref === input.href && primaryWindowNavigationIsCurrent(owned.generation)) {
      settlePrimaryWindowNavigationEffect(owned, 'committed')
      return
    }
    // The browser location has already changed. Advance navigation ownership
    // before settling the superseded effect.
    beginPrimaryWindowNavigation()
    settlePrimaryWindowNavigationEffect(owned, 'abandoned')
    return
  }
  beginPrimaryWindowNavigation()
}

function takeOwnedPrimaryWindowNavigation(
  generation?: PrimaryWindowNavigationGeneration,
): PrimaryWindowOwnedNavigation | null {
  const owned = ownedPrimaryWindowNavigation
  if (!owned || (generation !== undefined && owned.generation !== generation)) return null
  ownedPrimaryWindowNavigation = null
  return owned
}

function settlePrimaryWindowNavigationEffect(
  owned: PrimaryWindowOwnedNavigation,
  settlement: 'committed' | 'abandoned',
): void {
  try {
    if (settlement === 'committed') owned.commitEffect?.()
    else owned.abandonEffect?.()
    owned.resolveSettlement({ status: settlement })
  } catch (error) {
    owned.resolveSettlement({ status: 'failed', intendedStatus: settlement, error })
  }
}

export function resetPrimaryWindowNavigationForTest(): void {
  latestPrimaryWindowNavigationGeneration = 0
  ownedPrimaryWindowNavigation = null
}
