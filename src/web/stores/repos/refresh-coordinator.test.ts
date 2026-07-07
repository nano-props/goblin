import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  handleRepoInvalidationRefresh,
  repoInvalidationRefreshDisposition,
  resetRepoRefreshCoordinatorState,
  runRepoRefreshIntent,
  currentRepoStatusRefreshSnapshot,
} from '#/web/stores/repos/refresh-coordinator.ts'
import { beginRepoInvalidationSource, settleRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
import type { ReposGet } from '#/web/stores/repos/types.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

function callsGet() {
  const calls: string[] = []
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          instanceId: 'repo-instance-test-9',
          availability: { phase: 'available' },
        },
      },
      syncAndRefresh: (id: string, options?: { repoInstanceId?: string }) => {
        calls.push(`manual:${id}:${options?.repoInstanceId ?? ''}`)
        return Promise.resolve()
      },
      refreshCoreData: (id: string, options?: { repoInstanceId?: string }) => {
        calls.push(`core:${id}:${options?.repoInstanceId ?? ''}`)
        return Promise.resolve()
      },
    }) as unknown as ReturnType<ReposGet>
  return { calls, get }
}

describe('repo refresh coordinator', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetReposStore()
    resetRepoRefreshCoordinatorState()
  })

  afterEach(() => {
    resetRepoRefreshCoordinatorState()
    vi.useRealTimers()
  })

  test('builds status refresh snapshots from the React Query branch read model', () => {
    const repo = seedRepoWithReadModelForTest({
      id: '/repo',
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    setRepoSnapshotQueryData('/repo', repo.instanceId, {
      current: 'feature/query',
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: repo.instanceId,
      branchName: 'feature/query',
      worktreePath: '/tmp/query-worktree',
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    expect(currentRepoStatusRefreshSnapshot(repo, 'feature/query')).toMatchObject({
      id: '/repo',
      repoInstanceId: repo.instanceId,
      preferredWorkspacePaneTab: 'status',
      statusViewOpen: true,
    })
  })

  test('routes initial load through a coordinated snapshot and status refresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, {
      kind: 'core-data-changed',
      reason: 'initial-load',
      id: '/repo',
      repoInstanceId: 'repo-instance-test-7',
    })

    expect(calls).toEqual(['core:/repo:repo-instance-test-7'])
  })

  test('routes manual refresh requests through syncAndRefresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, {
      kind: 'manual-refresh-requested',
      id: '/repo',
      repoInstanceId: 'repo-instance-test-5',
    })

    expect(calls).toEqual(['manual:/repo:repo-instance-test-5'])
  })

  test('routes repo invalidation refreshes directly through the core refresh path', async () => {
    const { calls, get } = callsGet()

    await handleRepoInvalidationRefresh(get, { repoId: '/repo', query: 'repo-snapshot' }, 'repo-instance-test-9')

    expect(calls).toEqual(['core:/repo:repo-instance-test-9'])
  })

  test('suppresses repo invalidations from an active local source token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    beginRepoInvalidationSource('repo_branch_1')

    expect(repoInvalidationRefreshDisposition({ sourceToken: 'repo_branch_1' })).toBe('suppress')
  })

  test('suppresses repo invalidations from a recently settled local source token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    beginRepoInvalidationSource('repo_manual_1')
    settleRepoInvalidationSource('repo_manual_1')

    expect(repoInvalidationRefreshDisposition({ sourceToken: 'repo_manual_1' })).toBe('suppress')
  })

  test('refreshes repo invalidations from unrelated sources', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    beginRepoInvalidationSource('repo_manual_2')

    expect(repoInvalidationRefreshDisposition({ sourceToken: 'repo_manual_other' })).toBe('refresh')
  })

  test('does not change invalidation behavior when the coordinated core refresh throws', async () => {
    const get: ReposGet = () =>
      ({
        refreshCoreData: () => Promise.reject(new Error('boom')),
      }) as unknown as ReturnType<ReposGet>

    await expect(
      runRepoRefreshIntent(get, {
        kind: 'core-data-changed',
        reason: 'branch-action',
        id: '/repo',
        repoInstanceId: 'repo-instance-test-13',
      }),
    ).rejects.toThrow('boom')

    expect(repoInvalidationRefreshDisposition({})).toBe('refresh')
  })
})
