import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  repoInvalidationRefreshDisposition,
  recordBranchActionCoreRefreshSettled,
  recordBranchActionCoreRefreshStart,
  resetRepoRefreshCoordinatorState,
  runRepoRefreshIntent,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'

function callsGet() {
  const calls: string[] = []
  const get: ReposGet = () =>
    ({
      syncAndRefresh: (id: string, options?: { token?: number }) => {
        calls.push(`manual:${id}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
      refreshSnapshot: (id: string, options?: { token?: number }) => {
        calls.push(`snapshot:${id}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
      refreshStatus: (id: string, options?: { token?: number }) => {
        calls.push(`status:${id}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
      refreshPullRequests: (
        id: string,
        branches?: string[],
        options?: { token?: number; mode?: string; clearMissing?: boolean },
      ) => {
        calls.push(`prs:${id}:${branches?.join(',') ?? ''}:${options?.mode ?? ''}:${options?.token ?? ''}`)
        return Promise.resolve()
      },
    }) as ReturnType<ReposGet>
  return { calls, get }
}

describe('repo refresh coordinator', () => {
  beforeEach(() => {
    resetRepoRefreshCoordinatorState()
  })

  afterEach(() => {
    resetRepoRefreshCoordinatorState()
    vi.useRealTimers()
  })

  test('routes initial load through a coordinated snapshot and status refresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, { kind: 'core-data-changed', reason: 'initial-load', id: '/repo', token: 7 })

    expect(calls).toEqual(['snapshot:/repo:7', 'status:/repo:7'])
  })

  test('routes manual refresh requests through syncAndRefresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, { kind: 'manual-refresh-requested', id: '/repo', token: 5 })

    expect(calls).toEqual(['manual:/repo:5'])
  })

  test('runs invalidation refreshes through a single coordinated plan', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, { kind: 'core-data-changed', reason: 'repo-invalidated', id: '/repo', token: 9 })

    expect(calls).toEqual(['snapshot:/repo:9', 'status:/repo:9'])
  })

  test('runs visible pull request refreshes only when a branch is visible', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id: '/repo',
      token: 3,
      branch: 'feature/a',
    })
    await runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id: '/repo',
      token: 3,
      branch: null,
    })

    expect(calls).toEqual(['prs:/repo:feature/a:full:3'])
  })

  test('suppresses repo invalidation refreshes that immediately follow a settled branch-action refresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    recordBranchActionCoreRefreshStart('/repo', 11)
    const refreshedAt = Date.now() + 1
    vi.setSystemTime(refreshedAt)
    recordBranchActionCoreRefreshSettled('/repo', 11)

    expect(
      repoInvalidationRefreshDisposition({
        id: '/repo',
        instanceToken: 11,
        resources: {
          snapshot: { loadedAt: refreshedAt, stale: false },
          status: { loadedAt: refreshedAt, stale: false },
        },
      } as any),
    ).toBe('suppress')
  })

  test('defers repo invalidation refreshes while the branch-action follow-up refresh is still running', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    recordBranchActionCoreRefreshStart('/repo', 12)

    expect(
      repoInvalidationRefreshDisposition({
        id: '/repo',
        instanceToken: 12,
        resources: {
          snapshot: { loadedAt: null, stale: false },
          status: { loadedAt: null, stale: false },
        },
      } as any),
    ).toBe('defer')
  })

  test('settles branch-action invalidation tracking even when the coordinated core refresh throws', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const get: ReposGet = () =>
      ({
        refreshSnapshot: () => Promise.reject(new Error('boom')),
        refreshStatus: () => Promise.resolve(),
      }) as unknown as ReturnType<ReposGet>

    await expect(
      runRepoRefreshIntent(get, { kind: 'core-data-changed', reason: 'branch-action', id: '/repo', token: 13 }),
    ).rejects.toThrow('boom')

    expect(
      repoInvalidationRefreshDisposition({
        id: '/repo',
        instanceToken: 13,
        resources: {
          snapshot: { loadedAt: null, stale: false },
          status: { loadedAt: null, stale: false },
        },
      } as any),
    ).toBe('refresh')
  })
})
