import { Cron } from 'croner'
import PQueue from 'p-queue'
import { fetchRepo } from '#/server/modules/repo-write-paths.ts'
import { serverLogger } from '#/server/logger.ts'
import { getServerFetchIntervalSec, subscribeServerFetchInterval } from '#/server/modules/settings-source.ts'

interface BackgroundSyncActiveFetch {
  repoId: string
  ctrl: AbortController
}

interface BackgroundSyncState {
  repoIds: string[]
  lastFetchAtByRepo: Record<string, number | null>
  failureCountByRepo: Record<string, number>
  backoffUntilByRepo: Record<string, number | null>
  intervalMs: number
  job: Cron | null
  generation: number
  nextRepoIndex: number
  pendingScheduleGeneration: number | null
  idleDrainScheduled: boolean
  activeFetch: BackgroundSyncActiveFetch | null
}

export interface BackgroundSyncDiagnostics {
  running: boolean
  intervalSec: number
  repoIds: string[]
  nextRepoIndex: number
  tickRunning: boolean
  idleDrainScheduled: boolean
  queuePending: number
  queueSize: number
  repos: Array<{
    repoId: string
    lastFetchAt: number | null
    failureCount: number
    backoffUntil: number | null
    nextEligibleAt: number | null
  }>
}

const state: BackgroundSyncState = {
  repoIds: [],
  lastFetchAtByRepo: {},
  failureCountByRepo: {},
  backoffUntilByRepo: {},
  intervalMs: 0,
  job: null,
  generation: 0,
  nextRepoIndex: 0,
  pendingScheduleGeneration: null,
  idleDrainScheduled: false,
  activeFetch: null,
}

let settingsSubscription: (() => void) | null = null
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
  if (state.repoIds.length === 0 || state.intervalMs <= 0) return
  state.job = new Cron('* * * * * *', () => {
    requestScheduledFetch(generation)
  })
  requestScheduledFetch(generation)
}

async function ensureSettingsSubscription(): Promise<void> {
  if (settingsSubscription) return
  state.intervalMs = (await getServerFetchIntervalSec()) * 1000
  settingsSubscription = subscribeServerFetchInterval((sec) => {
    state.intervalMs = sec * 1000
    ensureBackgroundSyncJob(state.generation)
  })
}

function findNextDueRepo(now: number): string | null {
  if (state.repoIds.length === 0 || state.intervalMs <= 0) return null
  for (let offset = 0; offset < state.repoIds.length; offset += 1) {
    const index = (state.nextRepoIndex + offset) % state.repoIds.length
    const repoId = state.repoIds[index]
    if (!repoId) continue
    const lastFetchAt = state.lastFetchAtByRepo[repoId]
    const nextIntervalAt = lastFetchAt === null || lastFetchAt === undefined ? now : lastFetchAt + state.intervalMs
    const backoffUntil = state.backoffUntilByRepo[repoId] ?? null
    const nextEligibleAt = Math.max(nextIntervalAt, backoffUntil ?? 0)
    if (now >= nextEligibleAt) {
      state.nextRepoIndex = (index + 1) % state.repoIds.length
      return repoId
    }
  }
  return null
}

function hasDueRepo(now: number): boolean {
  if (state.repoIds.length === 0 || state.intervalMs <= 0) return false
  for (const repoId of state.repoIds) {
    const lastFetchAt = state.lastFetchAtByRepo[repoId]
    const nextIntervalAt = lastFetchAt === null || lastFetchAt === undefined ? now : lastFetchAt + state.intervalMs
    const backoffUntil = state.backoffUntilByRepo[repoId] ?? null
    const nextEligibleAt = Math.max(nextIntervalAt, backoffUntil ?? 0)
    if (now >= nextEligibleAt) return true
  }
  return false
}

function clearRepoBackoff(repoId: string): void {
  delete state.failureCountByRepo[repoId]
  delete state.backoffUntilByRepo[repoId]
}

function recordRepoFetchAttempt(repoId: string, at: number): void {
  state.lastFetchAtByRepo[repoId] = at
}

function computeBackoffDelayMs(failureCount: number): number {
  const base = Math.max(MIN_BACKOFF_MS, Math.min(MAX_BACKOFF_BASE_MS, state.intervalMs))
  return Math.min(base * 2 ** failureCount, MAX_BACKOFF_MS)
}

function shouldBackoffMessage(message: string): boolean {
  return message !== 'cancelled' && message !== 'error.network-op-in-progress'
}

function recordRepoFailure(repoId: string, now: number): void {
  const failureCount = (state.failureCountByRepo[repoId] ?? 0) + 1
  state.failureCountByRepo[repoId] = failureCount
  state.backoffUntilByRepo[repoId] = now + computeBackoffDelayMs(failureCount)
}

function nextEligibleAt(repoId: string, now: number = Date.now()): number | null {
  if (state.intervalMs <= 0) return null
  const lastFetchAt = state.lastFetchAtByRepo[repoId]
  const nextIntervalAt = lastFetchAt === null || lastFetchAt === undefined ? now : lastFetchAt + state.intervalMs
  const backoffUntil = state.backoffUntilByRepo[repoId] ?? null
  return Math.max(nextIntervalAt, backoffUntil ?? 0)
}

function abortActiveFetchForRepo(repoId: string): boolean {
  const active = state.activeFetch
  if (!active || active.repoId !== repoId) return false
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
  let repoId: string | null = null
  let activeFetch: BackgroundSyncActiveFetch | null = null
  try {
    repoId = findNextDueRepo(now)
    if (!repoId || state.intervalMs <= 0) return
    const ctrl = new AbortController()
    activeFetch = { repoId, ctrl }
    state.activeFetch = activeFetch
    const fetchStart = Date.now()
    const result = await fetchRepo(repoId, 'background', ctrl.signal)
    const fetchDuration = Date.now() - fetchStart
    // Log slow fetchs for performance monitoring
    if (fetchDuration > 5000) {
      backgroundSyncLogger.warn({ repoId, fetchDuration, intervalMs: state.intervalMs }, 'background fetch slow')
    }
    if (activeFetch.ctrl.signal.aborted) return
    recordRepoFetchAttempt(repoId, now)
    if (result.ok) {
      clearRepoBackoff(repoId)
      return
    }
    if (shouldBackoffMessage(result.message)) {
      recordRepoFailure(repoId, now)
      backgroundSyncLogger.warn(
        {
          repoId,
          reason: result.message,
          failureCount: state.failureCountByRepo[repoId],
          backoffUntil: state.backoffUntilByRepo[repoId],
        },
        'background fetch failed',
      )
    }
  } catch (err) {
    if (activeFetch?.ctrl.signal.aborted) return
    if (repoId) {
      recordRepoFetchAttempt(repoId, now)
      recordRepoFailure(repoId, now)
    }
    backgroundSyncLogger.warn(
      {
        err,
        repoId,
        failureCount: repoId ? state.failureCountByRepo[repoId] : undefined,
        backoffUntil: repoId ? state.backoffUntilByRepo[repoId] : undefined,
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

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await ensureSettingsSubscription()
  const nextRepoIds = Array.from(new Set(repoIds.filter((repoId) => typeof repoId === 'string' && repoId.length > 0)))
  // Short-circuit when the list is unchanged: the fetch-interval change is
  // already applied via `subscribeServerFetchInterval`, and bumping the
  // generation here would abort any in-flight background fetch for no gain.
  if (nextRepoIds.length === state.repoIds.length && nextRepoIds.every((repoId) => state.repoIds.includes(repoId))) {
    return
  }
  const removedRepoIds = state.repoIds.filter((repoId) => !nextRepoIds.includes(repoId))
  state.generation += 1
  for (const repoId of removedRepoIds) abortActiveFetchForRepo(repoId)
  for (const repoId of nextRepoIds) {
    if (state.lastFetchAtByRepo[repoId] === undefined) state.lastFetchAtByRepo[repoId] = null
  }
  state.repoIds = nextRepoIds
  if (state.nextRepoIndex >= state.repoIds.length) state.nextRepoIndex = 0
  ensureBackgroundSyncJob(state.generation)
}

export function stopBackgroundSync(): void {
  abortActiveFetch()
  state.generation += 1
  state.repoIds = []
  state.lastFetchAtByRepo = {}
  state.failureCountByRepo = {}
  state.backoffUntilByRepo = {}
  state.intervalMs = 0
  state.nextRepoIndex = 0
  state.pendingScheduleGeneration = null
  state.idleDrainScheduled = false
  state.activeFetch = null
  syncQueue.clear()
  stopBackgroundSyncJob()
}

export function getBackgroundSyncRepos(): string[] {
  return [...state.repoIds]
}

export function getBackgroundSyncDiagnostics(now: number = Date.now()): BackgroundSyncDiagnostics {
  return {
    running: !!state.job,
    intervalSec: Math.round(state.intervalMs / 1000),
    repoIds: [...state.repoIds],
    nextRepoIndex: state.nextRepoIndex,
    tickRunning: syncQueue.pending > 0,
    idleDrainScheduled: state.idleDrainScheduled,
    queuePending: syncQueue.pending,
    queueSize: syncQueue.size,
    repos: state.repoIds.map((repoId) => ({
      repoId,
      lastFetchAt: state.lastFetchAtByRepo[repoId] ?? null,
      failureCount: state.failureCountByRepo[repoId] ?? 0,
      backoffUntil: state.backoffUntilByRepo[repoId] ?? null,
      nextEligibleAt: nextEligibleAt(repoId, now),
    })),
  }
}

export function resetBackgroundSyncForTests(): void {
  stopBackgroundSync()
  settingsSubscription = null
}
