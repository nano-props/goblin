import type { HistoryState } from '@tanstack/history'

declare module '@tanstack/history' {
  interface HistoryState {
    __goblinPrimaryWindowNavigationGeneration?: number
  }
}

export type PrimaryWindowNavigationGeneration = number
export type PrimaryWindowNavigationIntentKind = 'user' | 'passive'

export const PRIMARY_WINDOW_NAVIGATION_STATE_KEY = '__goblinPrimaryWindowNavigationGeneration' as const

export type PrimaryWindowNavigationOutcome =
  | { status: 'committed' }
  | { status: 'abandoned' }
  | { status: 'superseded' }
  | {
      status: 'failed'
      intendedStatus: 'committed' | 'abandoned' | 'superseded'
      error: unknown
    }

export interface PrimaryWindowNavigationRegistration {
  readonly settled: Promise<PrimaryWindowNavigationOutcome>
  [Symbol.dispose](): void
  release(): void
  fail(error: unknown): void
}

export interface PrimaryWindowNavigationIntent {
  /** Internal identity used by history state and presentation-focus ownership. */
  readonly generation: PrimaryWindowNavigationGeneration
  readonly kind: PrimaryWindowNavigationIntentKind
  readonly settled: Promise<PrimaryWindowNavigationOutcome>
  isCurrent(): boolean
  outcome(): PrimaryWindowNavigationOutcome | null
  register(
    targetHref: string,
    commitEffect?: () => void,
    abandonEffect?: () => void,
  ): PrimaryWindowNavigationRegistration | null
  commit(commitEffect?: () => void): boolean
  [Symbol.dispose](): void
  release(): void
  fail(error: unknown): void
}

export type PassivePrimaryWindowNavigationIntentAdmission =
  | { kind: 'admitted'; intent: PrimaryWindowNavigationIntent }
  | {
      kind: 'occupied'
      ownerKind: PrimaryWindowNavigationIntentKind
      settled: Promise<PrimaryWindowNavigationOutcome>
    }

interface PrimaryWindowNavigationIntentRecord {
  generation: PrimaryWindowNavigationGeneration
  kind: PrimaryWindowNavigationIntentKind
  phase: 'admitted' | 'registered'
  targetHref: string | null
  commitEffect?: () => void
  abandonEffect?: () => void
  settled: Promise<PrimaryWindowNavigationOutcome>
  resolveSettlement: (outcome: PrimaryWindowNavigationOutcome) => void
  outcome: PrimaryWindowNavigationOutcome | null
  intent: PrimaryWindowNavigationIntent
}

let latestPrimaryWindowNavigationGeneration = 0
let currentPrimaryWindowNavigationIntentRecord: PrimaryWindowNavigationIntentRecord | null = null

export function beginPrimaryWindowNavigationIntent(
  kind: PrimaryWindowNavigationIntentKind = 'user',
): PrimaryWindowNavigationIntent {
  if (kind === 'passive') {
    const admission = tryBeginPassivePrimaryWindowNavigationIntent()
    if (admission.kind === 'occupied') {
      throw new Error('passive primary-window navigation requires unowned presentation')
    }
    return admission.intent
  }
  supersedeCurrentPrimaryWindowNavigationIntent()
  return createPrimaryWindowNavigationIntent('user')
}

export function tryBeginPassivePrimaryWindowNavigationIntent(): PassivePrimaryWindowNavigationIntentAdmission {
  const current = currentPrimaryWindowNavigationIntentRecord
  if (current) return { kind: 'occupied', ownerKind: current.kind, settled: current.settled }
  return { kind: 'admitted', intent: createPrimaryWindowNavigationIntent('passive') }
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
    observeExternalPrimaryWindowNavigation()
    return
  }
  const generation = input.state?.[PRIMARY_WINDOW_NAVIGATION_STATE_KEY]
  const current = currentPrimaryWindowNavigationIntentRecord
  if (current?.phase === 'registered' && current.generation === generation) {
    if (current.targetHref === input.href && primaryWindowNavigationIsCurrent(current.generation)) {
      settlePrimaryWindowNavigationIntent(current, 'committed')
      return
    }
    observeExternalPrimaryWindowNavigation()
    settlePrimaryWindowNavigationIntent(current, 'superseded')
    return
  }
  observeExternalPrimaryWindowNavigation()
}

function createPrimaryWindowNavigationIntent(kind: PrimaryWindowNavigationIntentKind): PrimaryWindowNavigationIntent {
  latestPrimaryWindowNavigationGeneration += 1
  const generation = latestPrimaryWindowNavigationGeneration
  const settlement = Promise.withResolvers<PrimaryWindowNavigationOutcome>()
  let record: PrimaryWindowNavigationIntentRecord
  const intent: PrimaryWindowNavigationIntent = {
    generation,
    kind,
    settled: settlement.promise,
    isCurrent: () => currentPrimaryWindowNavigationIntentRecord === record,
    outcome: () => record.outcome,
    register: (targetHref, commitEffect, abandonEffect) =>
      registerPrimaryWindowNavigationIntent(record, targetHref, commitEffect, abandonEffect),
    commit: (commitEffect) => commitPrimaryWindowNavigationIntent(record, commitEffect),
    [Symbol.dispose]: () => settlePrimaryWindowNavigationIntent(record, 'abandoned'),
    release: () => settlePrimaryWindowNavigationIntent(record, 'abandoned'),
    fail: (error) => failPrimaryWindowNavigationIntent(record, error),
  }
  record = {
    generation,
    kind,
    phase: 'admitted' as const,
    targetHref: null,
    settled: settlement.promise,
    resolveSettlement: settlement.resolve,
    outcome: null,
    intent,
  }
  currentPrimaryWindowNavigationIntentRecord = record
  return intent
}

function registerPrimaryWindowNavigationIntent(
  record: PrimaryWindowNavigationIntentRecord,
  targetHref: string,
  commitEffect?: () => void,
  abandonEffect?: () => void,
): PrimaryWindowNavigationRegistration | null {
  if (currentPrimaryWindowNavigationIntentRecord !== record || record.phase !== 'admitted') return null
  record.phase = 'registered'
  record.targetHref = targetHref
  record.commitEffect = commitEffect
  record.abandonEffect = abandonEffect
  return {
    settled: record.settled,
    [Symbol.dispose]: () => settlePrimaryWindowNavigationIntent(record, 'abandoned'),
    release: () => settlePrimaryWindowNavigationIntent(record, 'abandoned'),
    fail: (error) => failPrimaryWindowNavigationIntent(record, error),
  }
}

function commitPrimaryWindowNavigationIntent(
  record: PrimaryWindowNavigationIntentRecord,
  commitEffect?: () => void,
): boolean {
  if (currentPrimaryWindowNavigationIntentRecord !== record || record.phase !== 'admitted') return false
  record.commitEffect = commitEffect
  settlePrimaryWindowNavigationIntent(record, 'committed')
  return record.outcome?.status === 'committed'
}

function failPrimaryWindowNavigationIntent(record: PrimaryWindowNavigationIntentRecord, error: unknown): void {
  if (currentPrimaryWindowNavigationIntentRecord !== record) return
  settlePrimaryWindowNavigationIntent(
    record,
    'failed',
    error,
    record.phase === 'registered' ? 'committed' : 'abandoned',
  )
}

function supersedeCurrentPrimaryWindowNavigationIntent(): void {
  const current = currentPrimaryWindowNavigationIntentRecord
  if (current) settlePrimaryWindowNavigationIntent(current, 'superseded')
}

function observeExternalPrimaryWindowNavigation(): void {
  supersedeCurrentPrimaryWindowNavigationIntent()
  latestPrimaryWindowNavigationGeneration += 1
}

function settlePrimaryWindowNavigationIntent(
  record: PrimaryWindowNavigationIntentRecord,
  status: 'committed' | 'abandoned' | 'superseded' | 'failed',
  error?: unknown,
  failedIntendedStatus: 'committed' | 'abandoned' | 'superseded' = 'abandoned',
): void {
  if (currentPrimaryWindowNavigationIntentRecord !== record) return
  currentPrimaryWindowNavigationIntentRecord = null
  const intendedStatus = status === 'failed' ? failedIntendedStatus : status
  try {
    if (status === 'committed') record.commitEffect?.()
    else record.abandonEffect?.()
    const outcome: PrimaryWindowNavigationOutcome = status === 'failed' ? { status, intendedStatus, error } : { status }
    record.outcome = outcome
    record.resolveSettlement(outcome)
  } catch (effectError) {
    const outcome: PrimaryWindowNavigationOutcome = { status: 'failed', intendedStatus, error: effectError }
    record.outcome = outcome
    record.resolveSettlement(outcome)
  }
}

export function resetPrimaryWindowNavigationForTest(): void {
  latestPrimaryWindowNavigationGeneration = 0
  currentPrimaryWindowNavigationIntentRecord = null
}
