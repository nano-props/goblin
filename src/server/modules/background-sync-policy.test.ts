import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  backgroundSyncBackoffDelayMs,
  backgroundSyncNextEligibleAt,
  backgroundSyncTargetKey,
  sameBackgroundSyncTargets,
  shouldBackoffBackgroundSyncFailure,
  uniqueBackgroundSyncTargets,
  uniqueRegisteredBackgroundSyncTargets,
} from '#/server/modules/background-sync-policy.ts'

const WORKSPACE_A = workspaceIdForTest('goblin+file:///workspace-a')
const WORKSPACE_B = workspaceIdForTest('goblin+file:///workspace-b')
const targetA = { userId: 'user-a', workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' }
const targetB = { userId: 'user-a', workspaceId: WORKSPACE_B, workspaceRuntimeId: 'runtime-b' }

describe('background sync policy', () => {
  test('keys and deduplicates targets by authenticated runtime ownership', () => {
    expect(backgroundSyncTargetKey(targetA)).not.toBe(backgroundSyncTargetKey({ ...targetA, userId: 'user-b' }))
    expect(
      uniqueBackgroundSyncTargets('user-a', [
        { workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
        { workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
      ]),
    ).toEqual([targetA])
    expect(uniqueRegisteredBackgroundSyncTargets([targetA, targetB, targetA])).toEqual([targetA, targetB])
  })

  test('compares target sets independently of registration order', () => {
    expect(sameBackgroundSyncTargets([targetA, targetB], [targetB, targetA])).toBe(true)
    expect(sameBackgroundSyncTargets([targetA], [targetB])).toBe(false)
  })

  test('combines cadence and backoff into one eligibility time', () => {
    expect(
      backgroundSyncNextEligibleAt({ intervalMs: 5_000, lastFetchStartedAt: null, backoffUntil: null, now: 1_000 }),
    ).toBe(1_000)
    expect(
      backgroundSyncNextEligibleAt({
        intervalMs: 5_000,
        lastFetchStartedAt: 1_000,
        backoffUntil: 8_000,
        now: 2_000,
      }),
    ).toBe(8_000)
    expect(
      backgroundSyncNextEligibleAt({ intervalMs: 0, lastFetchStartedAt: 1_000, backoffUntil: null, now: 2_000 }),
    ).toBeNull()
  })

  test('bounds exponential backoff and excludes locally recoverable outcomes', () => {
    expect(backgroundSyncBackoffDelayMs(5_000, 1)).toBe(10_000)
    expect(backgroundSyncBackoffDelayMs(60_000, 20)).toBe(5 * 60_000)
    expect(shouldBackoffBackgroundSyncFailure('fatal: offline')).toBe(true)
    expect(shouldBackoffBackgroundSyncFailure('cancelled')).toBe(false)
    expect(shouldBackoffBackgroundSyncFailure('error.network-op-in-progress')).toBe(false)
  })
})
