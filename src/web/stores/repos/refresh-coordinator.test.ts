import { describe, expect, test } from 'vitest'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
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
  test('routes manual refresh requests through syncAndRefresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, { kind: 'manual-refresh-requested', id: '/repo', token: 5 })

    expect(calls).toEqual(['manual:/repo:5'])
  })

  test('runs invalidation refreshes through a single coordinated plan', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, { kind: 'repo-invalidated', id: '/repo', token: 9 })

    expect(calls).toEqual(['snapshot:/repo:9', 'status:/repo:9'])
  })

  test('runs branch selection refreshes only for the visible detail data', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, {
      kind: 'selected-branch-changed',
      id: '/repo',
      token: 3,
      branch: 'feature/a',
      tab: 'status',
    })

    expect(calls).toEqual(['prs:/repo:feature/a:full:3'])
  })
})
