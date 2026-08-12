import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'

const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_BASE_MS = 30_000
const MAX_BACKOFF_MS = 5 * 60_000

export interface RegisteredGitBackgroundSyncTarget extends GitBackgroundSyncTarget {
  userId: string
}

export interface BackgroundSyncTargetIdentity {
  userId: string
  workspaceId: GitBackgroundSyncTarget['workspaceId']
  workspaceRuntimeId: string
}

export function backgroundSyncTargetKey(target: BackgroundSyncTargetIdentity): string {
  return `${target.userId}\0${target.workspaceId}\0${target.workspaceRuntimeId}`
}

export function uniqueBackgroundSyncTargets<TTarget extends GitBackgroundSyncTarget>(
  userId: string,
  targets: readonly TTarget[],
): Array<TTarget & { userId: string }> {
  const unique = new Map<string, TTarget & { userId: string }>()
  for (const target of targets) {
    const registered = { userId, ...target }
    unique.set(backgroundSyncTargetKey(registered), registered)
  }
  return [...unique.values()]
}

export function uniqueRegisteredBackgroundSyncTargets<TTarget extends BackgroundSyncTargetIdentity>(
  targets: readonly TTarget[],
): TTarget[] {
  const unique = new Map<string, TTarget>()
  for (const target of targets) unique.set(backgroundSyncTargetKey(target), target)
  return [...unique.values()]
}

export function sameBackgroundSyncTargets(
  current: readonly BackgroundSyncTargetIdentity[],
  next: readonly BackgroundSyncTargetIdentity[],
): boolean {
  if (current.length !== next.length) return false
  const currentKeys = new Set(current.map(backgroundSyncTargetKey))
  return next.every((target) => currentKeys.has(backgroundSyncTargetKey(target)))
}

export function backgroundSyncNextEligibleAt(input: {
  intervalMs: number
  lastFetchStartedAt: number | null | undefined
  backoffUntil: number | null | undefined
  now: number
}): number | null {
  if (input.intervalMs <= 0) return null
  const nextIntervalAt =
    input.lastFetchStartedAt === null || input.lastFetchStartedAt === undefined
      ? input.now
      : input.lastFetchStartedAt + input.intervalMs
  return Math.max(nextIntervalAt, input.backoffUntil ?? 0)
}

export function backgroundSyncBackoffDelayMs(intervalMs: number, failureCount: number): number {
  const base = Math.max(MIN_BACKOFF_MS, Math.min(MAX_BACKOFF_BASE_MS, intervalMs))
  return Math.min(base * 2 ** failureCount, MAX_BACKOFF_MS)
}

export function shouldBackoffBackgroundSyncFailure(message: string): boolean {
  return message !== 'cancelled' && message !== 'error.network-op-in-progress'
}
