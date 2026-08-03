import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRefreshSyncHelpers, refreshFailureMessage } from '#/web/stores/workspaces/refresh-sync.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-client-state.test-utils.ts'
import { REPO_ID, branch, ipcHandlers, resetRefreshTest, seedRepo } from '#/web/stores/workspaces/refresh-test-utils.ts'

beforeEach(resetRefreshTest)

describe('refreshFailureMessage', () => {
  test('keeps a bare cancellation silent', () => {
    expect(refreshFailureMessage({ ok: false, message: 'cancelled' })).toBeNull()
  })

  test('surfaces recovery guidance attached to a cancellation', () => {
    expect(
      refreshFailureMessage({
        ok: false,
        message: 'cancelled',
        recoveryMessageKeys: ['error.workspace-runtime-settlement-failed'],
      }),
    ).toBe('error.workspace-runtime-settlement-failed')
  })

  test('surfaces an ordinary failure', () => {
    expect(refreshFailureMessage({ ok: false, message: 'error.failed-read-repo' })).toBe('error.failed-read-repo')
  })
})

describe('refresh sync pipeline', () => {
  test('records fetch recovery before a later read projection rejects', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    const fetchResult = {
      ok: false as const,
      message: 'cancelled',
      recoveryMessageKeys: ['error.workspace-runtime-settlement-failed'],
    }
    ipcHandlers['repo.fetch'] = async () => fetchResult
    const projectionFailure = new Error('projection failed')
    const refreshReadModels = vi.fn(async () => {
      const workspace = requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID])
      expect(workspace.capability.git.events.at(-1)).toMatchObject({
        kind: 'result',
        result: fetchResult,
      })
      throw projectionFailure
    })
    const { runRefreshSyncPipeline } = createRefreshSyncHelpers(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
      { refreshReadModels },
    )

    await expect(runRefreshSyncPipeline(REPO_ID, workspaceRuntimeId, new AbortController().signal)).rejects.toBe(
      projectionFailure,
    )
    expect(refreshReadModels).toHaveBeenCalledOnce()
    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.events.at(-1),
    ).toMatchObject({
      kind: 'result',
      result: fetchResult,
    })
  })
})
