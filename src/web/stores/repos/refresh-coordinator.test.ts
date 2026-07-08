import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  handleRepoInvalidationRefresh,
  resetRepoRefreshCoordinatorState,
  runRepoRefreshIntent,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { RepoRuntimeProjectionRefreshOptions, ReposGet } from '#/web/stores/repos/types.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

function callsGet() {
  const calls: string[] = []
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          repoRuntimeId: 'repo-runtime-test-9',
          availability: { phase: 'available' },
          dataLoads: {
            visibleStatus: { phase: 'idle', loadedAt: null, error: null, stale: false },
          },
        },
      },
      syncAndRefresh: (id: string, options?: { repoRuntimeId?: string }) => {
        calls.push(`manual:${id}:${options?.repoRuntimeId ?? ''}`)
        return Promise.resolve()
      },
      refreshCoreData: (id: string, options?: { repoRuntimeId?: string }) => {
        calls.push(`core:${id}:${options?.repoRuntimeId ?? ''}`)
        return Promise.resolve()
      },
      refreshRuntimeProjection: (
        id: string,
        options: RepoRuntimeProjectionRefreshOptions,
      ) => {
        calls.push(`projection:${id}:${options.repoRuntimeId ?? ''}:${options.scope}`)
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
  })

  test('routes initial load through a coordinated repo read-model projection refresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, {
      kind: 'core-data-changed',
      reason: 'initial-load',
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-7',
    })

    expect(calls).toEqual(['core:/repo:repo-runtime-test-7'])
  })

  test('routes manual refresh requests through syncAndRefresh', async () => {
    const { calls, get } = callsGet()

    await runRepoRefreshIntent(get, {
      kind: 'manual-refresh-requested',
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-5',
    })

    expect(calls).toEqual(['manual:/repo:repo-runtime-test-5'])
  })

  test('routes visible projection views through a visible projection refresh', async () => {
    const calls: string[] = []
    const repo = seedRepoWithReadModelForTest({
      id: '/repo',
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      repoRuntimeId: 'repo-runtime-test-9',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    const get: ReposGet = () =>
      ({
        ...useReposStore.getState(),
        refreshRuntimeProjection: (id: string, options: RepoRuntimeProjectionRefreshOptions) => {
          calls.push(
            `projection:${id}:${options.repoRuntimeId ?? ''}:${options.scope}:${
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
      repoRuntimeId: repo.repoRuntimeId,
      branchName: 'feature/query',
    })

    expect(calls).toEqual(['projection:/repo:repo-runtime-test-9:visible-status:feature/query'])
  })

  test('routes repo invalidation refreshes directly through the core refresh path', async () => {
    const { calls, get } = callsGet()

    await handleRepoInvalidationRefresh(get, { repoId: '/repo', query: 'repo-snapshot' }, 'repo-runtime-test-9')

    expect(calls).toEqual(['core:/repo:repo-runtime-test-9'])
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
        repoRuntimeId: 'repo-runtime-test-13',
      }),
    ).rejects.toThrow('boom')
  })
})
