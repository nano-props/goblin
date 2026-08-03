import { Cron } from 'croner'
import PQueue from 'p-queue'
import { fetchRepo } from '#/server/modules/repo-write-paths.ts'
import { serverLogger } from '#/server/logger.ts'
import { getServerFetchIntervalSec, subscribeServerFetchInterval } from '#/server/modules/settings-source.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { failRemoteWorkspaceRuntimeIfNeeded } from '#/server/modules/remote-workspace-runtime-failure-settlement.ts'
import { isRepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import { publishRepoMutationInvalidations } from '#/server/modules/repo-mutation-invalidation.ts'
import {
  onWorkspaceRuntimeClosed,
  onWorkspaceRuntimeFailed,
  onWorkspaceRuntimeMembershipReleased,
} from '#/server/modules/workspace-runtimes.ts'
import {
  backgroundSyncBackoffDelayMs,
  backgroundSyncNextEligibleAt,
  backgroundSyncTargetKey,
  sameBackgroundSyncTargets,
  shouldBackoffBackgroundSyncFailure,
  uniqueBackgroundSyncTargets,
  uniqueRegisteredBackgroundSyncTargets,
  type RegisteredGitBackgroundSyncTarget,
} from '#/server/modules/background-sync-policy.ts'

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
    lastFetchStartedAt: number | null
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
let runtimeFailureSubscription: (() => void) | null = null
let membershipReleaseSubscription: (() => void) | null = null
const backgroundSyncLogger = serverLogger.child({ module: 'background-sync' })
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
    stopBackgroundSyncRuntime(event.userId, event.workspaceId, event.workspaceRuntimeId)
  })
  runtimeFailureSubscription ??= onWorkspaceRuntimeFailed((event) => {
    stopBackgroundSyncRuntime(event.userId, event.workspaceId, event.workspaceRuntimeId)
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
    if (isTargetDue(target, now)) {
      state.nextTargetIndex = (index + 1) % state.targets.length
      return target
    }
  }
  return null
}

function hasDueRepo(now: number): boolean {
  if (state.targets.length === 0 || state.intervalMs <= 0) return false
  return state.targets.some((target) => isTargetDue(target, now))
}

function clearTargetBackoff(target: RegisteredGitBackgroundSyncTarget): void {
  const key = backgroundSyncTargetKey(target)
  delete state.failureCountByTarget[key]
  delete state.backoffUntilByTarget[key]
}

function recordTargetFetchStartedAt(target: RegisteredGitBackgroundSyncTarget, at: number): void {
  state.lastFetchStartedAtByTarget[backgroundSyncTargetKey(target)] = at
}

function recordTargetFailure(target: RegisteredGitBackgroundSyncTarget, now: number): void {
  const key = backgroundSyncTargetKey(target)
  const failureCount = (state.failureCountByTarget[key] ?? 0) + 1
  state.failureCountByTarget[key] = failureCount
  state.backoffUntilByTarget[key] = now + backgroundSyncBackoffDelayMs(state.intervalMs, failureCount)
}

function nextEligibleAt(target: RegisteredGitBackgroundSyncTarget, now: number = Date.now()): number | null {
  const key = backgroundSyncTargetKey(target)
  return backgroundSyncNextEligibleAt({
    intervalMs: state.intervalMs,
    lastFetchStartedAt: state.lastFetchStartedAtByTarget[key],
    backoffUntil: state.backoffUntilByTarget[key],
    now,
  })
}

function isTargetDue(target: RegisteredGitBackgroundSyncTarget, now: number): boolean {
  const eligibleAt = nextEligibleAt(target, now)
  return eligibleAt !== null && now >= eligibleAt
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
    publishRepoMutationInvalidations(target.workspaceId, result, ['metadata'])
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
    if (shouldBackoffBackgroundSyncFailure(result.message)) {
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
      await settleBackgroundRuntimeFailureOrStop(target, err)
      if (isRepoMutationRuntimeFailureError(err)) {
        publishRepoMutationInvalidations(target.workspaceId, err.mutation, ['metadata'])
      }
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

async function settleBackgroundRuntimeFailureOrStop(
  target: RegisteredGitBackgroundSyncTarget,
  error: unknown,
): Promise<void> {
  const runtimeFailure = isRepoMutationRuntimeFailureError(error) ? error.runtimeFailure : error
  try {
    const runtimeFailed = await failRemoteWorkspaceRuntimeIfNeeded(target.userId, runtimeFailure)
    if (!runtimeFailed) return
  } catch (settlementError) {
    backgroundSyncLogger.warn(
      { err: settlementError, workspaceId: target.workspaceId },
      'failed to settle background fetch runtime; stopping automatic sync for this runtime',
    )
  }
  // A classified runtime failure ends this runtime's automatic work whether
  // lifecycle settlement succeeded or became uncertain. User-driven reopen or
  // registration establishes a new runtime instead of replaying against this one.
  stopBackgroundSyncRuntime(target.userId, target.workspaceId, target.workspaceRuntimeId)
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
  syncQueue.clear()
  stopBackgroundSyncJob()
  settingsInitializationGeneration += 1
  settingsInitializationPromise = null
  settingsSubscription?.()
  settingsSubscription = null
  runtimeCloseSubscription?.()
  runtimeCloseSubscription = null
  runtimeFailureSubscription?.()
  runtimeFailureSubscription = null
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
        lastFetchStartedAt: state.lastFetchStartedAtByTarget[key] ?? null,
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

/** Stop automatic work owned by one exact runtime after its lifecycle becomes uncertain or closes. */
export function stopBackgroundSyncRuntime(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): void {
  const closedTarget = { userId, workspaceId, workspaceRuntimeId }
  const key = backgroundSyncTargetKey(closedTarget)
  for (const [ownerKey, admission] of state.registrationAdmissionsByOwner) {
    const admissionContainsRuntime = admission.targets.some(
      (target) => backgroundSyncTargetKey({ userId: admission.userId, ...target }) === key,
    )
    if (!admissionContainsRuntime) continue
    admission.controller.abort('workspace-runtime-background-sync-stopped')
    state.registrationAdmissionsByOwner.delete(ownerKey)
  }
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
  delete state.lastFetchStartedAtByTarget[backgroundSyncTargetKey(target)]
  clearTargetBackoff(target)
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
