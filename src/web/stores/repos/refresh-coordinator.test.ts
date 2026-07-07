import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  handleRepoInvalidationRefresh,
  repoInvalidationRefreshDisposition,
  resetRepoRefreshCoordinatorState,
  runRepoRefreshIntent,
  currentRepoVisibleProjectionRefreshState,
} from '#/web/stores/repos/refresh-coordinator.ts'
import { beginRepoInvalidationSource, settleRepoInvalidationSource } from '#/web/stores/repos/invalidation-sources.ts'
import type { RepoRuntimeProjectionRefreshOptions, ReposGet } from '#/web/stores/repos/types.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

function callsGet() {
  const calls: string[] = []
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          instanceId: 'repo-instance-test-9',
          availability: { phase: 'available' },
          dataLoads: {
            visibleStatus: { phase: 'idle', loadedAt: null, error: null, stale: false },
          },
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
      refreshRuntimeProjection: (
        id: string,
        options: RepoRuntimeProjectionRefreshOptions,
      ) => {
        calls.push(`projection:${id}:${options.repoInstanceId ?? ''}:${options.scope}`)
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

  test('builds visible projection refresh state from the React Query branch read model', () => {
    const repo = seedRepoWithReadModelForTest({
      id: '/repo',
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
      currentBranch: 'feature/query',
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: repo.instanceId,
      branchName: 'feature/query',
      worktreePath: '/tmp/query-worktree',
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    expect(currentRepoVisibleProjectionRefreshState(repo, 'feature/query')).toMatchObject({
      id: '/repo',
      repoInstanceId: repo.instanceId,
      preferredWorkspacePaneTab: 'status',
      branchName: 'feature/query',
      visibleProjectionViewOpen: true,
    })
  })

  test('treats the fallback rendered status tab as a visible projection view', () => {
    const branch = createRepoBranch('feature/query', { worktree: { path: '/tmp/query-worktree' } })
    const repo = seedRepoWithReadModelForTest({
      id: '/repo',
      branches: [branch],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'terminal',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [branch],
      currentBranch: 'feature/query',
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo',
      repoInstanceId: repo.instanceId,
      branchName: 'feature/query',
      worktreePath: '/tmp/query-worktree',
      tabs: [workspacePaneStaticTabEntry('status')],
    })

    expect(currentRepoVisibleProjectionRefreshState(repo, 'feature/query')).toMatchObject({
      preferredWorkspacePaneTab: 'terminal',
      visibleProjectionViewOpen: true,
    })
  })

  test('routes initial load through a coordinated repo read-model projection refresh', async () => {
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

  test('routes visible projection views through a visible projection refresh', async () => {
    const calls: string[] = []
    const repo = seedRepoWithReadModelForTest({
      id: '/repo',
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      instanceId: 'repo-instance-test-9',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    const get: ReposGet = () =>
      ({
        ...useReposStore.getState(),
        refreshRuntimeProjection: (id: string, options: RepoRuntimeProjectionRefreshOptions) => {
          calls.push(
            `projection:${id}:${options.repoInstanceId ?? ''}:${options.scope}:${
              options.scope === 'visible-status' ? options.branchName : ''
            }`,
          )
          return Promise.resolve()
        },
      }) as unknown as ReturnType<ReposGet>

    await runRepoRefreshIntent(get, {
      kind: 'visible-runtime-projection-requested',
      reason: 'visible-projection-view-opened',
      id: '/repo',
      repoInstanceId: repo.instanceId,
      branchName: 'feature/query',
    })

    expect(calls).toEqual(['projection:/repo:repo-instance-test-9:visible-status:feature/query'])
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
