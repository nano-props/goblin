import type { HistoryState } from '@tanstack/history'

declare module '@tanstack/history' {
  interface HistoryState {
    __goblinPrimaryWindowNavigationId?: string
  }
}

export interface PrimaryWindowPresentationToken {
  generation: number
}

export const PRIMARY_WINDOW_NAVIGATION_STATE_KEY = '__goblinPrimaryWindowNavigationId' as const

interface PrimaryWindowOwnedNavigation {
  token: PrimaryWindowPresentationToken
  targetHref: string
  commitEffect?: () => void
  abandonEffect?: () => void
  effectSettlement: 'pending' | 'committed' | 'abandoned'
  resolveSettlement: (outcome: PrimaryWindowNavigationOutcome) => void
  releasePresentationAbandon: () => void
}

export type PrimaryWindowNavigationOutcome =
  | { status: 'committed' }
  | { status: 'abandoned' }
  | { status: 'failed'; intendedStatus: 'committed' | 'abandoned'; error: unknown }

export interface PrimaryWindowNavigationRegistration {
  navigationId: string
  settled: Promise<PrimaryWindowNavigationOutcome>
}

export type PrimaryWindowHistoryObservationResult = { ok: true } | { ok: false; error: unknown }

let latestPrimaryWindowPresentationGeneration = 0
let nextPrimaryWindowNavigationId = 1
const ownedPrimaryWindowNavigations = new Map<string, PrimaryWindowOwnedNavigation>()
const primaryWindowPresentationAbandonEffects = new Map<number, Set<() => void>>()
const pendingPrimaryWindowNavigationAdmissions = new Set<() => void>()

export function beginPrimaryWindowPresentation(): PrimaryWindowPresentationToken {
  latestPrimaryWindowPresentationGeneration += 1
  const token = { generation: latestPrimaryWindowPresentationGeneration }
  discardPendingPrimaryWindowNavigationAdmissions()
  let firstFailure: { error: unknown } | null = null
  for (const [generation, effects] of Array.from(primaryWindowPresentationAbandonEffects)) {
    if (generation === token.generation) continue
    primaryWindowPresentationAbandonEffects.delete(generation)
    for (const effect of Array.from(effects)) {
      try {
        effect()
      } catch (error) {
        firstFailure ??= { error }
      }
    }
  }
  if (firstFailure) throw firstFailure.error
  return token
}

/**
 * Admits reconciliation immediately when no route navigation owns the primary
 * window. Pending admission resumes only if that ownership settles without a
 * browser-location commit; commit or supersession discards the stale source.
 */
export function admitPrimaryWindowNavigationWhenUncontested(onAdmitted: () => void): () => void {
  if (primaryWindowNavigationIsUncontested()) {
    onAdmitted()
    return () => {}
  }
  let active = true
  const admit = () => {
    if (!active) return
    active = false
    pendingPrimaryWindowNavigationAdmissions.delete(admit)
    onAdmitted()
  }
  pendingPrimaryWindowNavigationAdmissions.add(admit)
  return () => {
    if (!active) return
    active = false
    pendingPrimaryWindowNavigationAdmissions.delete(admit)
  }
}

export function primaryWindowNavigationIsUncontested(): boolean {
  return ownedPrimaryWindowNavigations.size === 0
}

export function primaryWindowPresentationIsCurrent(token: PrimaryWindowPresentationToken): boolean {
  return token.generation === latestPrimaryWindowPresentationGeneration
}

export function currentPrimaryWindowPresentationToken(): PrimaryWindowPresentationToken {
  return { generation: latestPrimaryWindowPresentationGeneration }
}

/** Registers ownership that must settle synchronously when its presentation is superseded. */
export function registerPrimaryWindowPresentationAbandon(
  token: PrimaryWindowPresentationToken,
  effect: () => void,
): () => void {
  if (!primaryWindowPresentationIsCurrent(token)) {
    effect()
    return () => {}
  }
  let effects = primaryWindowPresentationAbandonEffects.get(token.generation)
  if (!effects) {
    effects = new Set()
    primaryWindowPresentationAbandonEffects.set(token.generation, effects)
  }
  effects.add(effect)
  return () => {
    const current = primaryWindowPresentationAbandonEffects.get(token.generation)
    if (!current) return
    current.delete(effect)
    if (current.size === 0) primaryWindowPresentationAbandonEffects.delete(token.generation)
  }
}

export async function executePrimaryWindowNavigation(
  token: PrimaryWindowPresentationToken,
  navigate: () => Promise<unknown>,
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(token)) return false
  await navigate()
  return primaryWindowPresentationIsCurrent(token)
}

export function registerPrimaryWindowNavigation(
  token: PrimaryWindowPresentationToken,
  targetHref: string,
  commitEffect?: () => void,
  abandonEffect?: () => void,
): PrimaryWindowNavigationRegistration | null {
  if (!primaryWindowPresentationIsCurrent(token)) return null
  const navigationId = `primary-window-${token.generation}-${nextPrimaryWindowNavigationId++}`
  const settlement = Promise.withResolvers<PrimaryWindowNavigationOutcome>()
  const owned: PrimaryWindowOwnedNavigation = {
    token,
    targetHref,
    commitEffect,
    abandonEffect,
    effectSettlement: 'pending',
    resolveSettlement: settlement.resolve,
    releasePresentationAbandon: () => {},
  }
  ownedPrimaryWindowNavigations.set(navigationId, owned)
  owned.releasePresentationAbandon = registerPrimaryWindowPresentationAbandon(token, () => {
    ownedPrimaryWindowNavigations.delete(navigationId)
    settlePrimaryWindowNavigationEffect(owned, 'abandoned')
  })
  return { navigationId, settled: settlement.promise }
}

export function releasePrimaryWindowNavigation(navigationId: string | null): void {
  if (!navigationId) return
  const owned = ownedPrimaryWindowNavigations.get(navigationId)
  if (!owned) return
  ownedPrimaryWindowNavigations.delete(navigationId)
  settlePrimaryWindowNavigationEffect(owned, 'abandoned')
  if (primaryWindowNavigationIsUncontested()) resumePendingPrimaryWindowNavigationAdmissions()
}

export function primaryWindowNavigationState(state: HistoryState, navigationId: string): HistoryState {
  return { ...state, [PRIMARY_WINDOW_NAVIGATION_STATE_KEY]: navigationId }
}

export function observePrimaryWindowHistoryNavigation(input: {
  href: string
  state: HistoryState | undefined
  action: { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }
}): PrimaryWindowHistoryObservationResult {
  try {
    if (input.action.type === 'BACK' || input.action.type === 'FORWARD' || input.action.type === 'GO') {
      beginPrimaryWindowPresentation()
      return { ok: true }
    }
    const navigationId = input.state?.[PRIMARY_WINDOW_NAVIGATION_STATE_KEY]
    const owned = navigationId ? ownedPrimaryWindowNavigations.get(navigationId) : null
    if (navigationId && owned) {
      ownedPrimaryWindowNavigations.delete(navigationId)
      discardPendingPrimaryWindowNavigationAdmissions()
      if (owned.targetHref === input.href && primaryWindowPresentationIsCurrent(owned.token)) {
        settlePrimaryWindowNavigationEffect(owned, 'committed')
        return { ok: true }
      }
      // The browser location has already changed. Supersede presentation
      // authority before settling cleanup so an effect failure cannot leave
      // the previous generation current for the new URL.
      beginPrimaryWindowPresentation()
      settlePrimaryWindowNavigationEffect(owned, 'abandoned')
      return { ok: true }
    }
    beginPrimaryWindowPresentation()
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

function settlePrimaryWindowNavigationEffect(
  owned: PrimaryWindowOwnedNavigation,
  settlement: 'committed' | 'abandoned',
): void {
  if (owned.effectSettlement !== 'pending') return
  owned.effectSettlement = settlement
  owned.releasePresentationAbandon()
  try {
    if (settlement === 'committed') owned.commitEffect?.()
    else owned.abandonEffect?.()
    owned.resolveSettlement({ status: settlement })
  } catch (error) {
    owned.resolveSettlement({ status: 'failed', intendedStatus: settlement, error })
  }
}

export function resetPrimaryWindowPresentationForTest(): void {
  latestPrimaryWindowPresentationGeneration = 0
  nextPrimaryWindowNavigationId = 1
  ownedPrimaryWindowNavigations.clear()
  primaryWindowPresentationAbandonEffects.clear()
  pendingPrimaryWindowNavigationAdmissions.clear()
}

function resumePendingPrimaryWindowNavigationAdmissions(): void {
  const pending = Array.from(pendingPrimaryWindowNavigationAdmissions)
  pendingPrimaryWindowNavigationAdmissions.clear()
  for (const admit of pending) {
    const generation = latestPrimaryWindowPresentationGeneration
    admit()
    if (!primaryWindowNavigationIsUncontested() || latestPrimaryWindowPresentationGeneration !== generation) return
  }
}

function discardPendingPrimaryWindowNavigationAdmissions(): void {
  pendingPrimaryWindowNavigationAdmissions.clear()
}
