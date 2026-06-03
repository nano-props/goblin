import { Cron } from 'croner'
import PQueue from 'p-queue'
import { abortBackgroundServerNetworkOp } from '#/server/common/network-ops.ts'
import { fetchRepository } from '#/server/modules/repo.ts'
import { serverLogger } from '#/server/logger.ts'
import { getServerFetchIntervalSec, subscribeServerFetchInterval } from '#/server/modules/settings-source.ts'

interface BackgroundSyncState {
  repoIds: string[]
  lastFetchAtByRepo: Record<string, number | null>
  failureCountByRepo: Record<string, number>
  backoffUntilByRepo: Record<string, number | null>
  intervalMs: number
  job: Cron | null
  generation: number
  nextRepoIndex: number
  tickRunning: boolean
}

export interface BackgroundSyncDiagnostics {
  running: boolean
  intervalSec: number
  repoIds: string[]
  nextRepoIndex: number
  tickRunning: boolean
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
  tickRunning: false,
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
  if (state.repoIds.length === 0 || state.intervalMs <= 0) return
  state.job = new Cron('* * * * * *', () => {
    void enqueueScheduledFetch(generation)
  })
  void enqueueScheduledFetch(generation)
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
    const nextIntervalAt =
      lastFetchAt === null || lastFetchAt === undefined ? now : lastFetchAt + state.intervalMs
    const backoffUntil = state.backoffUntilByRepo[repoId] ?? null
    const nextEligibleAt = Math.max(nextIntervalAt, backoffUntil ?? 0)
    if (now >= nextEligibleAt) {
      state.nextRepoIndex = (index + 1) % state.repoIds.length
      return repoId
    }
  }
  return null
}

function clearRepoBackoff(repoId: string): void {
  delete state.failureCountByRepo[repoId]
  delete state.backoffUntilByRepo[repoId]
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

async function enqueueScheduledFetch(generation: number): Promise<void> {
  if (generation !== state.generation || state.intervalMs <= 0) return
  if (syncQueue.pending + syncQueue.size > 0) return
  await syncQueue.add(async () => {
    await runScheduledFetch(generation)
  })
}

async function runScheduledFetch(generation: number): Promise<void> {
  if (generation !== state.generation || state.tickRunning) return
  state.tickRunning = true
  const now = Date.now()
  let repoId: string | null = null
  try {
    repoId = findNextDueRepo(now)
    if (!repoId || state.intervalMs <= 0) return
    state.lastFetchAtByRepo[repoId] = now
    const fetchStart = Date.now()
    const result = await fetchRepository(repoId, 'background')
    const fetchDuration = Date.now() - fetchStart
    // Log slow fetchs for performance monitoring
    if (fetchDuration > 5000) {
      backgroundSyncLogger.warn(
        { repoId, fetchDuration, intervalMs: state.intervalMs },
        'background fetch slow',
      )
    }
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
    if (repoId) recordRepoFailure(repoId, now)
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
    state.tickRunning = false
  }
}

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await ensureSettingsSubscription()
  const nextRepoIds = Array.from(new Set(repoIds.filter((repoId) => typeof repoId === 'string' && repoId.length > 0)))
  const removedRepoIds = state.repoIds.filter((repoId) => !nextRepoIds.includes(repoId))
  state.generation += 1
  const nextLastFetchAtByRepo: Record<string, number | null> = {}
  const nextFailureCountByRepo: Record<string, number> = {}
  const nextBackoffUntilByRepo: Record<string, number | null> = {}
  for (const repoId of removedRepoIds) abortBackgroundServerNetworkOp(repoId)
  for (const repoId of nextRepoIds) {
    nextLastFetchAtByRepo[repoId] = state.lastFetchAtByRepo[repoId] ?? null
    if (state.failureCountByRepo[repoId]) nextFailureCountByRepo[repoId] = state.failureCountByRepo[repoId]!
    if (state.backoffUntilByRepo[repoId] !== undefined) nextBackoffUntilByRepo[repoId] = state.backoffUntilByRepo[repoId]!
  }
  state.repoIds = nextRepoIds
  state.lastFetchAtByRepo = nextLastFetchAtByRepo
  state.failureCountByRepo = nextFailureCountByRepo
  state.backoffUntilByRepo = nextBackoffUntilByRepo
  if (state.nextRepoIndex >= state.repoIds.length) state.nextRepoIndex = 0
  ensureBackgroundSyncJob(state.generation)
}

export function stopBackgroundSync(): void {
  for (const repoId of state.repoIds) abortBackgroundServerNetworkOp(repoId)
  state.generation += 1
  state.repoIds = []
  state.lastFetchAtByRepo = {}
  state.failureCountByRepo = {}
  state.backoffUntilByRepo = {}
  state.intervalMs = 0
  state.nextRepoIndex = 0
  state.tickRunning = false
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
    tickRunning: state.tickRunning,
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
