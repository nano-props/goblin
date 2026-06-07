import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  repoInvalidationRefreshDisposition,
  resetRepoRefreshCoordinatorState,
  runRepoRefreshIntent,
} from '#/web/stores/repos/refresh-coordinator.ts'
import { beginRepoInvalidationSource, settleRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
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

  test('suppresses repo invalidations from an active local source token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    beginRepoInvalidationSource('repo_branch_1')
    const refreshedAt = Date.now()

    expect(
      repoInvalidationRefreshDisposition({
        id: '/repo',
        instanceToken: 11,
        resources: {
          snapshot: { loadedAt: refreshedAt, stale: false },
          status: { loadedAt: refreshedAt, stale: false },
        },
      } as any, { sourceToken: 'repo_branch_1' }),
    ).toBe('suppress')
  })

  test('suppresses repo invalidations from a recently settled local source token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    beginRepoInvalidationSource('repo_manual_1')
    settleRepoInvalidationSource('repo_manual_1')

    expect(
      repoInvalidationRefreshDisposition({
        id: '/repo',
        instanceToken: 12,
        resources: {
          snapshot: { loadedAt: null, stale: false },
          status: { loadedAt: null, stale: false },
        },
      } as any, { sourceToken: 'repo_manual_1' }),
    ).toBe('suppress')
  })

  test('refreshes repo invalidations from unrelated sources', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    beginRepoInvalidationSource('repo_manual_2')

    expect(
      repoInvalidationRefreshDisposition({
        id: '/repo',
        instanceToken: 21,
        resources: {
          snapshot: { loadedAt: Date.now(), stale: false },
          status: { loadedAt: Date.now(), stale: false },
        },
      } as any, { sourceToken: 'repo_manual_other' }),
    ).toBe('refresh')
  })

  test('does not change invalidation behavior when the coordinated core refresh throws', async () => {
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
      } as any, {}),
    ).toBe('refresh')
  })
})
