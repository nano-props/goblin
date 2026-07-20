import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey } from '#/web/repo-data-query.ts'
import { handleRepoInvalidationRefresh } from '#/web/stores/workspaces/repo-refresh-actions.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

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
  })

  afterEach(() => primaryWindowQueryClient.clear())

  test('does not issue Git refreshes for a filesystem-only workspace', async () => {
    const store = repoRefreshStoreAccess('workspace-runtime-test-9', 'filesystem')
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    await handleRepoInvalidationRefresh(
      store,
      { repoId: WORKSPACE_ID, query: 'repo-snapshot' },
      'workspace-runtime-test-9',
    )

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

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: repoDataQueryKey(WORKSPACE_ID, 'workspace-runtime-test-9'),
        refetchType: 'active',
        predicate: expect.any(Function),
      },
      { cancelRefetch: false },
    )
    invalidateSpy.mockRestore()
  })

  test('routes worktree snapshot invalidation through its narrower query domain', async () => {
    const store = repoRefreshStoreAccess()
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')

    await handleRepoInvalidationRefresh(
      store,
      { repoId: WORKSPACE_ID, query: 'repo-worktree-snapshot' },
      'workspace-runtime-test-9',
    )

    expect(invalidateSpy).toHaveBeenCalledWith(
      {
        queryKey: repoDataQueryKey(WORKSPACE_ID, 'workspace-runtime-test-9'),
        refetchType: 'active',
        predicate: expect.any(Function),
      },
      { cancelRefetch: false },
    )
    expect(invalidateSpy).toHaveBeenCalledOnce()
    invalidateSpy.mockRestore()
  })
})
