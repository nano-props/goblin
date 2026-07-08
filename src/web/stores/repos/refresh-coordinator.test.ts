import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import {
  requestRepoProjectionReadModelRefresh,
  requestRepoRuntimeProjectionRefresh,
  runManualRepoSync,
} from '#/web/stores/repos/refresh.ts'
import {
  handleRepoInvalidationRefresh,
  resetRepoRefreshCoordinatorState,
  runRepoRefreshIntent,
} from '#/web/stores/repos/refresh-coordinator.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'

vi.mock('#/web/stores/repos/refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/refresh.ts')>()
  return {
    ...actual,
    requestRepoProjectionReadModelRefresh: vi.fn(async () => {}),
    requestRepoRuntimeProjectionRefresh: vi.fn(async () => {}),
    runManualRepoSync: vi.fn(async () => {}),
  }
})

function repoRefreshStoreAccess(repoRuntimeId = 'repo-runtime-test-9') {
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          repoRuntimeId,
          availability: { phase: 'available' },
          dataLoads: {
            visibleStatus: { phase: 'idle', loadedAt: null, error: null, stale: false },
          },
        },
      },
    }) as unknown as ReturnType<ReposGet>
  return { get, set: vi.fn() as unknown as ReposSet }
}

describe('repo refresh coordinator', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetReposStore()
    resetRepoRefreshCoordinatorState()
    vi.mocked(requestRepoProjectionReadModelRefresh).mockReset()
    vi.mocked(requestRepoRuntimeProjectionRefresh).mockReset()
    vi.mocked(runManualRepoSync).mockReset()
    vi.mocked(requestRepoProjectionReadModelRefresh).mockResolvedValue(undefined)
    vi.mocked(requestRepoRuntimeProjectionRefresh).mockResolvedValue(undefined)
    vi.mocked(runManualRepoSync).mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetRepoRefreshCoordinatorState()
  })

  test('routes initial load through a coordinated repo read-model projection refresh', async () => {
    const store = repoRefreshStoreAccess()

    await runRepoRefreshIntent(store, {
      kind: 'projection-read-model-refresh-requested',
      reason: 'initial-load',
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-7',
    })

    expect(requestRepoProjectionReadModelRefresh).toHaveBeenCalledWith(store, '/repo', {
      repoRuntimeId: 'repo-runtime-test-7',
    })
  })

  test('routes manual refresh requests through manual repo sync', async () => {
    const store = repoRefreshStoreAccess()

    await runRepoRefreshIntent(store, {
      kind: 'manual-refresh-requested',
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-5',
    })

    expect(runManualRepoSync).toHaveBeenCalledWith(store, '/repo', { repoRuntimeId: 'repo-runtime-test-5' })
  })

  test('routes visible projection views through a visible projection refresh', async () => {
    const store = repoRefreshStoreAccess()

    await runRepoRefreshIntent(store, {
      kind: 'visible-runtime-projection-requested',
      reason: 'visible-projection-view-opened',
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-9',
      branchName: 'feature/query',
    })

    expect(requestRepoRuntimeProjectionRefresh).toHaveBeenCalledWith(store, '/repo', {
      repoRuntimeId: 'repo-runtime-test-9',
      scope: 'visible-status',
      branchName: 'feature/query',
    })
  })

  test('routes repo snapshot invalidation through query invalidation only', async () => {
    const store = repoRefreshStoreAccess()
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    await handleRepoInvalidationRefresh(store, { repoId: '/repo', query: 'repo-snapshot' }, 'repo-runtime-test-9')

    expect(requestRepoProjectionReadModelRefresh).not.toHaveBeenCalled()
    expect(requestRepoRuntimeProjectionRefresh).not.toHaveBeenCalled()
    expect(runManualRepoSync).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: repoDataQueryKey('/repo', 'repo-runtime-test-9'),
      refetchType: 'none',
    })
    invalidateSpy.mockRestore()
  })

  test('does not swallow projection refresh service errors', async () => {
    const store = repoRefreshStoreAccess()
    vi.mocked(requestRepoProjectionReadModelRefresh).mockRejectedValueOnce(new Error('boom'))

    await expect(
      runRepoRefreshIntent(store, {
        kind: 'projection-read-model-refresh-requested',
        reason: 'branch-action',
        id: '/repo',
        repoRuntimeId: 'repo-runtime-test-13',
      }),
    ).rejects.toThrow('boom')
  })
})
