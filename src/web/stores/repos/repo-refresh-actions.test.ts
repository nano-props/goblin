import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/repos/worktree-status-refresh.ts'
import {
  handleRepoInvalidationRefresh,
  requestVisibleWorkspaceStatusRefresh,
} from '#/web/stores/repos/repo-refresh-actions.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { refreshWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'

vi.mock('#/web/stores/repos/worktree-status-refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/worktree-status-refresh.ts')>()
  return { ...actual, refreshRepoWorktreeStatus: vi.fn(async () => {}) }
})
vi.mock('#/web/workspace-runtime-query.ts', () => ({ refreshWorkspaceRuntimes: vi.fn() }))
vi.mock('#/web/stores/repos/remote-lifecycle-projection.ts', () => ({ acceptRemoteLifecycleSnapshot: vi.fn() }))

function repoRefreshStoreAccess(workspaceRuntimeId = 'repo-runtime-test-9', unavailable = false) {
  const get: ReposGet = () =>
    ({
      repos: {
        'goblin+file:///repo': {
          id: 'goblin+file:///repo',
          workspaceRuntimeId,
          availability: unavailable
            ? { phase: 'unavailable', reason: 'offline', checkedAt: 1 }
            : { phase: 'available' },
        },
      },
    }) as unknown as ReturnType<ReposGet>
  return { get, set: vi.fn() as unknown as ReposSet }
}

describe('repo refresh actions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    vi.mocked(refreshRepoWorktreeStatus).mockReset()
    vi.mocked(refreshRepoWorktreeStatus).mockResolvedValue(undefined)
    vi.mocked(refreshWorkspaceRuntimes).mockReset()
    vi.mocked(acceptRemoteLifecycleSnapshot).mockReset()
  })

  afterEach(() => primaryWindowQueryClient.clear())

  test('requests visible status only for the current available runtime with a branch', () => {
    const store = repoRefreshStoreAccess()

    expect(
      requestVisibleWorkspaceStatusRefresh(store, 'goblin+file:///repo', 'repo-runtime-test-9', 'feature/query'),
    ).toBe(true)
    expect(
      requestVisibleWorkspaceStatusRefresh(store, 'goblin+file:///repo', 'repo-runtime-stale', 'feature/query'),
    ).toBe(false)
    expect(requestVisibleWorkspaceStatusRefresh(store, 'goblin+file:///repo', 'repo-runtime-test-9', null)).toBe(false)
    expect(
      requestVisibleWorkspaceStatusRefresh(
        repoRefreshStoreAccess('repo-runtime-test-9', true),
        'goblin+file:///repo',
        'repo-runtime-test-9',
        'feature/query',
      ),
    ).toBe(false)
    expect(refreshRepoWorktreeStatus).toHaveBeenCalledOnce()
    expect(refreshRepoWorktreeStatus).toHaveBeenCalledWith(store, 'goblin+file:///repo', 'repo-runtime-test-9')
  })

  test('routes repo snapshot invalidation through query invalidation only', async () => {
    const store = repoRefreshStoreAccess()
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    await handleRepoInvalidationRefresh(
      store,
      { repoId: 'goblin+file:///repo', query: 'repo-snapshot' },
      'repo-runtime-test-9',
    )

    expect(refreshRepoWorktreeStatus).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: repoDataQueryKey('goblin+file:///repo', 'repo-runtime-test-9'), refetchType: 'active' },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })

  test('refreshes remote lifecycle state even while the repo is unavailable', async () => {
    const store = repoRefreshStoreAccess('repo-runtime-test-9', true)
    const snapshot = { runtimes: [] }
    vi.mocked(refreshWorkspaceRuntimes).mockResolvedValue(snapshot)

    await handleRepoInvalidationRefresh(
      store,
      { repoId: 'goblin+file:///repo', query: 'remote-lifecycle' },
      'repo-runtime-test-9',
    )

    expect(refreshWorkspaceRuntimes).toHaveBeenCalledOnce()
    expect(acceptRemoteLifecycleSnapshot).toHaveBeenCalledWith(store.set, store.get, snapshot)
  })
})
