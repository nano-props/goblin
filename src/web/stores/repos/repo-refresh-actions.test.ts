import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { requestRepoRuntimeProjectionRefresh } from '#/web/stores/repos/refresh.ts'
import {
  handleRepoInvalidationRefresh,
  requestVisibleRepoRuntimeProjectionRefresh,
} from '#/web/stores/repos/repo-refresh-actions.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

vi.mock('#/web/stores/repos/refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/refresh.ts')>()
  return { ...actual, requestRepoRuntimeProjectionRefresh: vi.fn(async () => {}) }
})

function repoRefreshStoreAccess(repoRuntimeId = 'repo-runtime-test-9') {
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          repoRuntimeId,
          availability: { phase: 'available' },
          dataLoads: { visibleStatus: { phase: 'idle', loadedAt: null, error: null, stale: false } },
        },
      },
    }) as unknown as ReturnType<ReposGet>
  return { get, set: vi.fn() as unknown as ReposSet }
}

describe('repo refresh actions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    vi.mocked(requestRepoRuntimeProjectionRefresh).mockReset()
    vi.mocked(requestRepoRuntimeProjectionRefresh).mockResolvedValue(undefined)
  })

  afterEach(() => primaryWindowQueryClient.clear())

  test('requests a visible projection only for the current idle runtime', async () => {
    const store = repoRefreshStoreAccess()

    await requestVisibleRepoRuntimeProjectionRefresh(store, '/repo', 'repo-runtime-test-9', 'feature/query')
    await requestVisibleRepoRuntimeProjectionRefresh(store, '/repo', 'repo-runtime-stale', 'feature/query')

    expect(requestRepoRuntimeProjectionRefresh).toHaveBeenCalledOnce()
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

    expect(requestRepoRuntimeProjectionRefresh).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: repoDataQueryKey('/repo', 'repo-runtime-test-9'), refetchType: 'active' },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })
})
