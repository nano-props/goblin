import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { refreshVisibleStatusCache } from '#/web/stores/repos/visible-status-refresh.ts'
import {
  handleRepoInvalidationRefresh,
  requestVisibleWorkspaceStatusRefresh,
} from '#/web/stores/repos/repo-refresh-actions.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { refreshRepoRuntimes } from '#/web/repo-runtime-query.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'

vi.mock('#/web/stores/repos/visible-status-refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/visible-status-refresh.ts')>()
  return { ...actual, refreshVisibleStatusCache: vi.fn(async () => {}) }
})
vi.mock('#/web/repo-runtime-query.ts', () => ({ refreshRepoRuntimes: vi.fn() }))
vi.mock('#/web/stores/repos/remote-lifecycle-projection.ts', () => ({ acceptRemoteLifecycleSnapshot: vi.fn() }))

function repoRefreshStoreAccess(
  repoRuntimeId = 'repo-runtime-test-9',
  unavailable = false,
  visibleStatusPhase: 'idle' | 'loading' | 'refreshing' = 'idle',
) {
  const get: ReposGet = () =>
    ({
      repos: {
        '/repo': {
          id: '/repo',
          repoRuntimeId,
          availability: unavailable
            ? { phase: 'unavailable', reason: 'offline', checkedAt: 1 }
            : { phase: 'available' },
          dataLoads: { visibleStatus: { phase: visibleStatusPhase, loadedAt: null, error: null, stale: false } },
        },
      },
    }) as unknown as ReturnType<ReposGet>
  return { get, set: vi.fn() as unknown as ReposSet }
}

describe('repo refresh actions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    vi.mocked(refreshVisibleStatusCache).mockReset()
    vi.mocked(refreshVisibleStatusCache).mockResolvedValue(undefined)
    vi.mocked(refreshRepoRuntimes).mockReset()
    vi.mocked(acceptRemoteLifecycleSnapshot).mockReset()
  })

  afterEach(() => primaryWindowQueryClient.clear())

  test('requests visible status only for the current idle runtime with a branch', () => {
    const store = repoRefreshStoreAccess()

    expect(requestVisibleWorkspaceStatusRefresh(store, '/repo', 'repo-runtime-test-9', 'feature/query')).toBe(true)
    expect(requestVisibleWorkspaceStatusRefresh(store, '/repo', 'repo-runtime-stale', 'feature/query')).toBe(false)
    expect(requestVisibleWorkspaceStatusRefresh(store, '/repo', 'repo-runtime-test-9', null)).toBe(false)
    expect(
      requestVisibleWorkspaceStatusRefresh(
        repoRefreshStoreAccess('repo-runtime-test-9', true),
        '/repo',
        'repo-runtime-test-9',
        'feature/query',
      ),
    ).toBe(false)
    expect(
      requestVisibleWorkspaceStatusRefresh(
        repoRefreshStoreAccess('repo-runtime-test-9', false, 'loading'),
        '/repo',
        'repo-runtime-test-9',
        'feature/query',
      ),
    ).toBe(false)

    expect(refreshVisibleStatusCache).toHaveBeenCalledOnce()
    expect(refreshVisibleStatusCache).toHaveBeenCalledWith(store, '/repo', 'repo-runtime-test-9', 'feature/query')
  })

  test('routes repo snapshot invalidation through query invalidation only', async () => {
    const store = repoRefreshStoreAccess()
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    await handleRepoInvalidationRefresh(store, { repoId: '/repo', query: 'repo-snapshot' }, 'repo-runtime-test-9')

    expect(refreshVisibleStatusCache).not.toHaveBeenCalled()
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
