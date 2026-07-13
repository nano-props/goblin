import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { requestRepoRuntimeProjectionRefresh } from '#/web/stores/repos/refresh.ts'
import { handleRepoInvalidationRefresh } from '#/web/stores/repos/repo-refresh-actions.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { refreshRepoRuntimes } from '#/web/repo-runtime-query.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'

vi.mock('#/web/stores/repos/refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/refresh.ts')>()
  return { ...actual, requestRepoRuntimeProjectionRefresh: vi.fn(async () => {}) }
})
vi.mock('#/web/repo-runtime-query.ts', () => ({ refreshRepoRuntimes: vi.fn() }))
vi.mock('#/web/stores/repos/remote-lifecycle-projection.ts', () => ({ acceptRemoteLifecycleSnapshot: vi.fn() }))

function repoRefreshStoreAccess(repoRuntimeId = 'repo-runtime-test-9', unavailable = false) {
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          repoRuntimeId,
          availability: unavailable
            ? { phase: 'unavailable', reason: 'offline', checkedAt: 1 }
            : { phase: 'available' },
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
    vi.mocked(refreshRepoRuntimes).mockReset()
    vi.mocked(acceptRemoteLifecycleSnapshot).mockReset()
  })

  afterEach(() => primaryWindowQueryClient.clear())

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

  test('refreshes remote lifecycle state even while the repo is unavailable', async () => {
    const store = repoRefreshStoreAccess('repo-runtime-test-9', true)
    const snapshot = { runtimes: [] }
    vi.mocked(refreshRepoRuntimes).mockResolvedValue(snapshot)

    await handleRepoInvalidationRefresh(store, { repoId: '/repo', query: 'remote-lifecycle' }, 'repo-runtime-test-9')

    expect(refreshRepoRuntimes).toHaveBeenCalledOnce()
    expect(acceptRemoteLifecycleSnapshot).toHaveBeenCalledWith(store.set, store.get, snapshot)
  })
})
