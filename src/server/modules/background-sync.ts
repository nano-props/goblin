import { Cron } from 'croner'
import PQueue from 'p-queue'
import { fetchRepo } from '#/server/modules/repo-write-paths.ts'
import { serverLogger } from '#/server/logger.ts'
import { getServerFetchIntervalSec, subscribeServerFetchInterval } from '#/server/modules/settings-source.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { onWorkspaceRuntimeClosed, onWorkspaceRuntimeMembershipReleased } from '#/server/modules/workspace-runtimes.ts'

interface RegisteredGitBackgroundSyncTarget extends GitBackgroundSyncTarget {
  userId: string
}

interface BackgroundSyncActiveFetch {
  target: RegisteredGitBackgroundSyncTarget
  ctrl: AbortController
}

export interface BackgroundSyncRegistrationAdmission {
  readonly revision: number
  readonly userId: string
  readonly clientId: string
  readonly targets: readonly GitBackgroundSyncTarget[]
  readonly signal: AbortSignal
}

interface ActiveBackgroundSyncRegistrationAdmission extends BackgroundSyncRegistrationAdmission {
  controller: AbortController
}

interface BackgroundSyncState {
  targets: RegisteredGitBackgroundSyncTarget[]
  targetsByOwner: Map<string, RegisteredGitBackgroundSyncTarget[]>
  registrationAdmissionsByOwner: Map<string, ActiveBackgroundSyncRegistrationAdmission>
  latestRegistrationRevisionByOwner: Map<string, number>
  lastFetchStartedAtByTarget: Record<string, number | null>
  failureCountByTarget: Record<string, number>
  backoffUntilByTarget: Record<string, number | null>
  intervalMs: number
  job: Cron | null
  generation: number
  nextTargetIndex: number
  pendingScheduleGeneration: number | null
  idleDrainScheduled: boolean
  activeFetch: BackgroundSyncActiveFetch | null
}

export interface BackgroundSyncDiagnostics {
  running: boolean
  intervalSec: number
  repoIds: WorkspaceId[]
  nextRepoIndex: number
  tickRunning: boolean
  idleDrainScheduled: boolean
  queuePending: number
  queueSize: number
  repos: Array<{
    repoId: WorkspaceId
    lastFetchAt: number | null
    failureCount: number
    backoffUntil: number | null
    nextEligibleAt: number | null
  }>
}

const state: BackgroundSyncState = {
  targets: [],
  targetsByOwner: new Map(),
  registrationAdmissionsByOwner: new Map(),
  latestRegistrationRevisionByOwner: new Map(),
  lastFetchStartedAtByTarget: {},
  failureCountByTarget: {},
  backoffUntilByTarget: {},
  intervalMs: 0,
  job: null,
  generation: 0,
  nextTargetIndex: 0,
  pendingScheduleGeneration: null,
  idleDrainScheduled: false,
  activeFetch: null,
}

let settingsSubscription: (() => void) | null = null
let settingsInitializationPromise: Promise<void> | null = null
let settingsInitializationGeneration = 0
let runtimeCloseSubscription: (() => void) | null = null
let membershipReleaseSubscription: (() => void) | null = null
const backgroundSyncLogger = serverLogger.child({ module: 'background-sync' })
const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_BASE_MS = 30_000
const MAX_BACKOFF_MS = 5 * 60_000
const syncQueue = new PQueue({ concurrency: 1 })

function stopBackgroundSyncJob(): void {
  state.job?.stop()
  state.job = null
}

function ensureBackgroundSyncJob(generation: number): void {
  stopBackgroundSyncJob()
  syncQueue.clear()
  state.pendingScheduleGeneration = null
  state.idleDrainScheduled = false
  if (state.targets.length === 0 || state.intervalMs <= 0) return
  state.job = new Cron('* * * * * *', () => {
    requestScheduledFetch(generation)
  })
  requestScheduledFetch(generation)
}

export async function prepareBackgroundSync(): Promise<void> {
  if (settingsSubscription) return
  if (settingsInitializationPromise) return await settingsInitializationPromise
  runtimeCloseSubscription ??= onWorkspaceRuntimeClosed((event) => {
    removeBackgroundSyncRuntime(event.userId, event.workspaceId, event.workspaceRuntimeId)
  })
  membershipReleaseSubscription ??= onWorkspaceRuntimeMembershipReleased((event) => {
    releaseBackgroundSyncMembership(
      event.userId,
      event.clientId,
      event.workspaceId,
      event.workspaceRuntimeId,
      event.hasRemainingMemberships,
    )
  })
  const generation = settingsInitializationGeneration
  const initialization = initializeBackgroundSyncSettings(generation)
  settingsInitializationPromise = initialization
  try {
    await initialization
  } finally {
    if (settingsInitializationPromise === initialization) settingsInitializationPromise = null
  }
}

async function initializeBackgroundSyncSettings(generation: number): Promise<void> {
  const intervalMs = (await getServerFetchIntervalSec()) * 1000
  if (generation !== settingsInitializationGeneration) return
  state.intervalMs = intervalMs
  settingsSubscription = subscribeServerFetchInterval((sec) => {
    state.intervalMs = sec * 1000
    ensureBackgroundSyncJob(state.generation)
  })
}

function findNextDueTarget(now: number): RegisteredGitBackgroundSyncTarget | null {
  if (state.targets.length === 0 || state.intervalMs <= 0) return null
  for (let offset = 0; offset < state.targets.length; offset += 1) {
    const index = (state.nextTargetIndex + offset) % state.targets.length
    const target = state.targets[index]
    if (!target) continue
    const key = backgroundSyncTargetKey(target)
    const lastFetchStartedAt = state.lastFetchStartedAtByTarget[key]
    const nextIntervalAt =
      lastFetchStartedAt === null || lastFetchStartedAt === undefined ? now : lastFetchStartedAt + state.intervalMs
    const backoffUntil = state.backoffUntilByTarget[key] ?? null
    const nextEligibleAt = Math.max(nextIntervalAt, backoffUntil ?? 0)
    if (now >= nextEligibleAt) {
      state.nextTargetIndex = (index + 1) % state.targets.length
      return target
    }
  }
  return null
}

function hasDueRepo(now: number): boolean {
  if (state.targets.length === 0 || state.intervalMs <= 0) return false
  for (const target of state.targets) {
    const key = backgroundSyncTargetKey(target)
    const lastFetchStartedAt = state.lastFetchStartedAtByTarget[key]
    const nextIntervalAt =
      lastFetchStartedAt === null || lastFetchStartedAt === undefined ? now : lastFetchStartedAt + state.intervalMs
    const backoffUntil = state.backoffUntilByTarget[key] ?? null
    const nextEligibleAt = Math.max(nextIntervalAt, backoffUntil ?? 0)
    if (now >= nextEligibleAt) return true
  }
  return false
}

function clearTargetBackoff(target: RegisteredGitBackgroundSyncTarget): void {
  const key = backgroundSyncTargetKey(target)
  delete state.failureCountByTarget[key]
  delete state.backoffUntilByTarget[key]
}

function recordTargetFetchStartedAt(target: RegisteredGitBackgroundSyncTarget, at: number): void {
  state.lastFetchStartedAtByTarget[backgroundSyncTargetKey(target)] = at
}

function computeBackoffDelayMs(failureCount: number): number {
  const base = Math.max(MIN_BACKOFF_MS, Math.min(MAX_BACKOFF_BASE_MS, state.intervalMs))
  return Math.min(base * 2 ** failureCount, MAX_BACKOFF_MS)
}

function shouldBackoffMessage(message: string): boolean {
  return message !== 'cancelled' && message !== 'error.network-op-in-progress'
}

function recordTargetFailure(target: RegisteredGitBackgroundSyncTarget, now: number): void {
  const key = backgroundSyncTargetKey(target)
  const failureCount = (state.failureCountByTarget[key] ?? 0) + 1
  state.failureCountByTarget[key] = failureCount
  state.backoffUntilByTarget[key] = now + computeBackoffDelayMs(failureCount)
}

function nextEligibleAt(target: RegisteredGitBackgroundSyncTarget, now: number = Date.now()): number | null {
  if (state.intervalMs <= 0) return null
  const key = backgroundSyncTargetKey(target)
  const lastFetchStartedAt = state.lastFetchStartedAtByTarget[key]
  const nextIntervalAt =
    lastFetchStartedAt === null || lastFetchStartedAt === undefined ? now : lastFetchStartedAt + state.intervalMs
  const backoffUntil = state.backoffUntilByTarget[key] ?? null
  return Math.max(nextIntervalAt, backoffUntil ?? 0)
}

function abortActiveFetchForTarget(target: RegisteredGitBackgroundSyncTarget): boolean {
  const active = state.activeFetch
  if (!active || backgroundSyncTargetKey(active.target) !== backgroundSyncTargetKey(target)) return false
  active.ctrl.abort('background-sync-repo-removed')
  return true
}

function abortActiveFetch(): void {
  state.activeFetch?.ctrl.abort('background-sync-stopped')
  state.activeFetch = null
}

function requestScheduledFetch(generation: number): void {
  if (generation !== state.generation || state.intervalMs <= 0) return
  state.pendingScheduleGeneration = generation
  if (syncQueue.pending + syncQueue.size > 0) {
    if (!state.idleDrainScheduled) {
      state.idleDrainScheduled = true
      void syncQueue.onIdle().then(() => {
        state.idleDrainScheduled = false
        drainScheduledFetchQueue()
      })
    }
    return
  }
  drainScheduledFetchQueue()
}

function drainScheduledFetchQueue(): void {
  if (syncQueue.pending + syncQueue.size > 0) return
  const generation = state.pendingScheduleGeneration
  if (generation === null) return
  state.pendingScheduleGeneration = null
  void syncQueue.add(async () => {
    await runScheduledFetch(generation)
  })
}

async function runScheduledFetch(generation: number): Promise<void> {
  if (generation !== state.generation || state.intervalMs <= 0) return
  const now = Date.now()
  let target: RegisteredGitBackgroundSyncTarget | null = null
  let activeFetch: BackgroundSyncActiveFetch | null = null
  try {
    target = findNextDueTarget(now)
    if (!target || state.intervalMs <= 0) return
    const ctrl = new AbortController()
    activeFetch = { target, ctrl }
    state.activeFetch = activeFetch
    const fetchStart = Date.now()
    const result = await fetchRepo(target.workspaceId, 'background', ctrl.signal, target.workspaceRuntimeId)
    const fetchDuration = Date.now() - fetchStart
    // Log slow fetchs for performance monitoring
    if (fetchDuration > 5000) {
      backgroundSyncLogger.warn(
        { workspaceId: target.workspaceId, fetchDuration, intervalMs: state.intervalMs },
        'background fetch slow',
      )
    }
    if (activeFetch.ctrl.signal.aborted) return
    recordTargetFetchStartedAt(target, now)
    if (result.ok) {
      clearTargetBackoff(target)
      return
    }
    if (shouldBackoffMessage(result.message)) {
      recordTargetFailure(target, now)
      const key = backgroundSyncTargetKey(target)
      backgroundSyncLogger.warn(
        {
          workspaceId: target.workspaceId,
          reason: result.message,
          failureCount: state.failureCountByTarget[key],
          backoffUntil: state.backoffUntilByTarget[key],
        },
        'background fetch failed',
      )
    }
  } catch (err) {
    if (activeFetch?.ctrl.signal.aborted) return
    if (target) {
      recordTargetFetchStartedAt(target, now)
      recordTargetFailure(target, now)
    }
    const key = target ? backgroundSyncTargetKey(target) : null
    backgroundSyncLogger.warn(
      {
        err,
        workspaceId: target?.workspaceId,
        failureCount: key ? state.failureCountByTarget[key] : undefined,
        backoffUntil: key ? state.backoffUntilByTarget[key] : undefined,
      },
      'background fetch threw',
    )
  } finally {
    if (state.activeFetch === activeFetch) state.activeFetch = null
    if (generation === state.generation && state.intervalMs > 0 && hasDueRepo(Date.now())) {
      requestScheduledFetch(generation)
    }
  }
}

export function beginBackgroundSyncRegistration(
  userId: string,
  clientId: string,
  revision: number,
  targets: readonly GitBackgroundSyncTarget[],
): BackgroundSyncRegistrationAdmission | null {
  const ownerKey = backgroundSyncOwnerKey(userId, clientId)
  if (revision <= (state.latestRegistrationRevisionByOwner.get(ownerKey) ?? 0)) return null
  state.latestRegistrationRevisionByOwner.set(ownerKey, revision)
  state.registrationAdmissionsByOwner.get(ownerKey)?.controller.abort('background-sync-registration-superseded')
  const controller = new AbortController()
  const admission: ActiveBackgroundSyncRegistrationAdmission = {
    revision,
    userId,
    clientId,
    targets: [...targets],
    signal: controller.signal,
    controller,
  }
  state.registrationAdmissionsByOwner.set(ownerKey, admission)
  return admission
}

export function commitBackgroundSyncRegistration(admission: BackgroundSyncRegistrationAdmission): boolean {
  if (!settingsSubscription) throw new Error('background sync is not prepared')
  const ownerKey = backgroundSyncOwnerKey(admission.userId, admission.clientId)
  if (state.registrationAdmissionsByOwner.get(ownerKey) !== admission || admission.signal.aborted) {
    return false
  }
  const ownerTargets = uniqueBackgroundSyncTargets(admission.userId, admission.targets)
  if (ownerTargets.length > 0) state.targetsByOwner.set(ownerKey, ownerTargets)
  else state.targetsByOwner.delete(ownerKey)
  applyBackgroundSyncTargets(uniqueRegisteredBackgroundSyncTargets([...state.targetsByOwner.values()].flat()))
  return true
}

export function finishBackgroundSyncRegistration(admission: BackgroundSyncRegistrationAdmission): void {
  const ownerKey = backgroundSyncOwnerKey(admission.userId, admission.clientId)
  if (state.registrationAdmissionsByOwner.get(ownerKey) === admission) {
    state.registrationAdmissionsByOwner.delete(ownerKey)
  }
}

function applyBackgroundSyncTargets(nextTargets: RegisteredGitBackgroundSyncTarget[]): void {
  // Short-circuit when the list is unchanged: the fetch-interval change is
  // already applied via `subscribeServerFetchInterval`, and bumping the
  // generation here would abort any in-flight background fetch for no gain.
  if (sameBackgroundSyncTargets(state.targets, nextTargets)) return
  const nextTargetKeys = new Set(nextTargets.map(backgroundSyncTargetKey))
  const removedTargets = state.targets.filter((target) => !nextTargetKeys.has(backgroundSyncTargetKey(target)))
  state.generation += 1
  for (const target of removedTargets) {
    abortActiveFetchForTarget(target)
  }
  for (const target of nextTargets) {
    const key = backgroundSyncTargetKey(target)
    if (state.lastFetchStartedAtByTarget[key] === undefined) state.lastFetchStartedAtByTarget[key] = null
  }
  state.targets = nextTargets
  if (state.nextTargetIndex >= state.targets.length) state.nextTargetIndex = 0
  ensureBackgroundSyncJob(state.generation)
}

export function stopBackgroundSync(): void {
  abortActiveFetch()
  state.generation += 1
  state.targets = []
  state.targetsByOwner.clear()
  for (const admission of state.registrationAdmissionsByOwner.values()) {
    admission.controller.abort('background-sync-stopped')
  }
  state.registrationAdmissionsByOwner.clear()
  state.latestRegistrationRevisionByOwner.clear()
  state.lastFetchStartedAtByTarget = {}
  state.failureCountByTarget = {}
  state.backoffUntilByTarget = {}
  state.intervalMs = 0
  state.nextTargetIndex = 0
  state.pendingScheduleGeneration = null
  state.idleDrainScheduled = false
  state.activeFetch = null
  syncQueue.clear()
  stopBackgroundSyncJob()
  settingsInitializationGeneration += 1
  settingsInitializationPromise = null
  settingsSubscription?.()
  settingsSubscription = null
  runtimeCloseSubscription?.()
  runtimeCloseSubscription = null
  membershipReleaseSubscription?.()
  membershipReleaseSubscription = null
}

export function getBackgroundSyncRepos(userId: string): WorkspaceId[] {
  return state.targets.filter((target) => target.userId === userId).map((target) => target.workspaceId)
}

export function getBackgroundSyncDiagnostics(now: number = Date.now()): BackgroundSyncDiagnostics {
  return {
    running: !!state.job,
    intervalSec: Math.round(state.intervalMs / 1000),
    repoIds: state.targets.map((target) => target.workspaceId),
    nextRepoIndex: state.nextTargetIndex,
    tickRunning: syncQueue.pending > 0,
    idleDrainScheduled: state.idleDrainScheduled,
    queuePending: syncQueue.pending,
    queueSize: syncQueue.size,
    repos: state.targets.map((target) => {
      const key = backgroundSyncTargetKey(target)
      return {
        repoId: target.workspaceId,
        lastFetchAt: state.lastFetchStartedAtByTarget[key] ?? null,
        failureCount: state.failureCountByTarget[key] ?? 0,
        backoffUntil: state.backoffUntilByTarget[key] ?? null,
        nextEligibleAt: nextEligibleAt(target, now),
      }
    }),
  }
}

export function getBackgroundSyncHealth(): {
  running: boolean
  intervalSec: number
  registeredTargetCount: number
  tickRunning: boolean
  queuePending: number
  queueSize: number
} {
  return {
    running: !!state.job,
    intervalSec: Math.round(state.intervalMs / 1000),
    registeredTargetCount: state.targets.length,
    tickRunning: syncQueue.pending > 0,
    queuePending: syncQueue.pending,
    queueSize: syncQueue.size,
  }
}

export function resetBackgroundSyncForTests(): void {
  stopBackgroundSync()
}

function backgroundSyncTargetKey(target: RegisteredGitBackgroundSyncTarget): string {
  return `${target.userId}\0${target.workspaceId}\0${target.workspaceRuntimeId}`
}

function uniqueBackgroundSyncTargets(
  userId: string,
  targets: readonly GitBackgroundSyncTarget[],
): RegisteredGitBackgroundSyncTarget[] {
  const unique = new Map<string, RegisteredGitBackgroundSyncTarget>()
  for (const target of targets) {
    const registered = { userId, ...target }
    unique.set(backgroundSyncTargetKey(registered), registered)
  }
  return [...unique.values()]
}

function uniqueRegisteredBackgroundSyncTargets(
  targets: readonly RegisteredGitBackgroundSyncTarget[],
): RegisteredGitBackgroundSyncTarget[] {
  const unique = new Map<string, RegisteredGitBackgroundSyncTarget>()
  for (const target of targets) unique.set(backgroundSyncTargetKey(target), target)
  return [...unique.values()]
}

function sameBackgroundSyncTargets(
  current: readonly RegisteredGitBackgroundSyncTarget[],
  next: readonly RegisteredGitBackgroundSyncTarget[],
): boolean {
  if (current.length !== next.length) return false
  const currentKeys = new Set(current.map(backgroundSyncTargetKey))
  return next.every((target) => currentKeys.has(backgroundSyncTargetKey(target)))
}

function removeBackgroundSyncRuntime(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): void {
  const closedTarget = { userId, workspaceId, workspaceRuntimeId }
  const key = backgroundSyncTargetKey(closedTarget)
  const wasRegistered = state.targets.some((target) => backgroundSyncTargetKey(target) === key)
  const hadCadence = state.lastFetchStartedAtByTarget[key] !== undefined
  if (!wasRegistered && !hadCadence) return
  if (wasRegistered) {
    for (const [ownerKey, targets] of state.targetsByOwner) {
      const remaining = targets.filter((target) => backgroundSyncTargetKey(target) !== key)
      if (remaining.length > 0) state.targetsByOwner.set(ownerKey, remaining)
      else state.targetsByOwner.delete(ownerKey)
    }
    applyBackgroundSyncTargets(uniqueRegisteredBackgroundSyncTargets([...state.targetsByOwner.values()].flat()))
  }
  clearTargetState(closedTarget)
}

function clearTargetState(target: RegisteredGitBackgroundSyncTarget): void {
  const key = backgroundSyncTargetKey(target)
  delete state.lastFetchStartedAtByTarget[key]
  delete state.failureCountByTarget[key]
  delete state.backoffUntilByTarget[key]
}

function releaseBackgroundSyncMembership(
  userId: string,
  clientId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  hasRemainingMemberships: boolean,
): void {
  const ownerKey = backgroundSyncOwnerKey(userId, clientId)
  const releasedTargetKey = backgroundSyncTargetKey({ userId, workspaceId, workspaceRuntimeId })
  const admission = state.registrationAdmissionsByOwner.get(ownerKey)
  const admissionOwnsReleasedTarget = admission?.targets.some(
    (target) => backgroundSyncTargetKey({ userId, ...target }) === releasedTargetKey,
  )
  if (!hasRemainingMemberships || admissionOwnsReleasedTarget) {
    admission?.controller.abort('workspace-runtime-membership-released')
    state.registrationAdmissionsByOwner.delete(ownerKey)
  }

  const ownerTargets = state.targetsByOwner.get(ownerKey)
  if (!hasRemainingMemberships) state.latestRegistrationRevisionByOwner.delete(ownerKey)
  if (!ownerTargets) return
  const remaining = hasRemainingMemberships
    ? ownerTargets.filter((target) => backgroundSyncTargetKey(target) !== releasedTargetKey)
    : []
  if (remaining.length === ownerTargets.length) return
  if (remaining.length > 0) state.targetsByOwner.set(ownerKey, remaining)
  else state.targetsByOwner.delete(ownerKey)
  applyBackgroundSyncTargets(uniqueRegisteredBackgroundSyncTargets([...state.targetsByOwner.values()].flat()))
}

function backgroundSyncOwnerKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}
