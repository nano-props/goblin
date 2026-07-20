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
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

vi.mock('#/web/stores/workspaces/worktree-status-refresh.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof WorktreeStatusRefresh>()
  return { ...actual, refreshRepoWorktreeStatus: vi.fn(async () => {}) }
})

function repoRefreshStoreAccess(
  workspaceRuntimeId = 'workspace-runtime-test-9',
  capability: 'git' | 'filesystem' | 'unavailable' = 'git',
) {
  const workspace = emptyWorkspace(WORKSPACE_ID, 'workspace', workspaceRuntimeId)
  if (capability === 'unavailable') {
    acceptWorkspaceProbeState(workspace, {
      status: 'unavailable',
      reason: 'error.workspace-path-not-found',
    })
  } else {
    acceptWorkspaceProbeState(workspace, {
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git:
          capability === 'git'
            ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
            : { status: 'unavailable' },
      },
      diagnostics: [],
    })
  }
  const get = (() => ({ workspaces: { [WORKSPACE_ID]: workspace } })) as WorkspacesGet
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

    expect(requestVisibleWorkspaceStatusRefresh(store, WORKSPACE_ID, 'workspace-runtime-test-9', 'feature/query')).toBe(
      true,
    )
    expect(requestVisibleWorkspaceStatusRefresh(store, WORKSPACE_ID, 'workspace-runtime-stale', 'feature/query')).toBe(
      false,
    )
    expect(requestVisibleWorkspaceStatusRefresh(store, WORKSPACE_ID, 'workspace-runtime-test-9', null)).toBe(false)
    expect(
      requestVisibleWorkspaceStatusRefresh(
        repoRefreshStoreAccess('workspace-runtime-test-9', 'unavailable'),
        WORKSPACE_ID,
        'workspace-runtime-test-9',
        'feature/query',
      ),
    ).toBe(false)
    expect(refreshRepoWorktreeStatus).toHaveBeenCalledOnce()
    expect(refreshRepoWorktreeStatus).toHaveBeenCalledWith(store, WORKSPACE_ID, 'workspace-runtime-test-9')
  })

  test('does not issue Git refreshes for a filesystem-only workspace', async () => {
    const store = repoRefreshStoreAccess('workspace-runtime-test-9', 'filesystem')
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    expect(requestVisibleWorkspaceStatusRefresh(store, WORKSPACE_ID, 'workspace-runtime-test-9', 'stale-branch')).toBe(
      false,
    )
    await handleRepoInvalidationRefresh(
      store,
      { repoId: WORKSPACE_ID, query: 'repo-snapshot' },
      'workspace-runtime-test-9',
    )

    expect(refreshRepoWorktreeStatus).not.toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
    invalidateSpy.mockRestore()
  })

  test('routes repo snapshot invalidation through query invalidation only', async () => {
    const store = repoRefreshStoreAccess()
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    await handleRepoInvalidationRefresh(
      store,
      { repoId: WORKSPACE_ID, query: 'repo-snapshot' },
      'workspace-runtime-test-9',
    )

    expect(refreshRepoWorktreeStatus).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: repoDataQueryKey(WORKSPACE_ID, 'workspace-runtime-test-9'), refetchType: 'active' },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })
})
