import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import {
  handleRepoInvalidationRefresh,
  requestVisibleWorkspaceStatusRefresh,
} from '#/web/stores/workspaces/repo-refresh-actions.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type * as WorktreeStatusRefresh from '#/web/stores/workspaces/worktree-status-refresh.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')

vi.mock('#/web/stores/workspaces/worktree-status-refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreeStatusRefresh>()
  return { ...actual, refreshRepoWorktreeStatus: vi.fn(async () => {}) }
})

function repoRefreshStoreAccess(workspaceRuntimeId = 'repo-runtime-test-9', unavailable = false) {
  const get: WorkspacesGet = () =>
    ({
      workspaces: {
        'goblin+file:///repo': {
          id: 'goblin+file:///repo',
          workspaceRuntimeId,
          availability: unavailable
            ? { phase: 'unavailable', reason: 'offline', checkedAt: 1 }
            : { phase: 'available' },
        },
      },
    }) as unknown as ReturnType<WorkspacesGet>
  return { get, set: vi.fn() as unknown as WorkspacesSet }
}

describe('repo refresh actions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    vi.mocked(refreshRepoWorktreeStatus).mockReset()
    vi.mocked(refreshRepoWorktreeStatus).mockResolvedValue(undefined)
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

    await handleRepoInvalidationRefresh(store, { repoId: WORKSPACE_ID, query: 'repo-snapshot' }, 'repo-runtime-test-9')

    expect(refreshRepoWorktreeStatus).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: repoDataQueryKey('goblin+file:///repo', 'repo-runtime-test-9'), refetchType: 'active' },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })
})
