import { beforeEach, describe, expect, test, vi } from 'vitest'
import { refreshStatusLog } from '#/web/logger.ts'
import { getRepoSnapshotQueryData, getRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { REPO_ID, branch, ipcHandlers, resetRefreshTest, seedRepo } from '#/web/stores/workspaces/refresh-test-utils.ts'
import { createRepoWorktreeSnapshotForTest } from '#/web/test-utils/repo-store.ts'

beforeEach(resetRefreshTest)

describe('independent worktree status refresh', () => {
  test('updates status without replacing the accepted repository snapshot', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')], undefined, [
      createRepoWorktreeSnapshotForTest('feature/a', '/tmp/worktree-a'),
    ])
    const snapshotBefore = getRepoSnapshotQueryData(REPO_ID, workspaceRuntimeId)
    ipcHandlers['repo.worktreeStatus'] = () => ({
      workspaceRuntimeId,
      status: [
        { path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'file.ts' }] },
      ],
      loadedAt: Date.now(),
    })

    await refreshRepoWorktreeStatus({ get: workspacesStore.getState }, REPO_ID, workspaceRuntimeId)

    expect(getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.status[0]?.entries).toHaveLength(1)
    expect(getRepoSnapshotQueryData(REPO_ID, workspaceRuntimeId)).toBe(snapshotBefore)
  })

  test('keeps accepted status when a background status refresh fails', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    const acceptedStatus = getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)
    ipcHandlers['repo.worktreeStatus'] = () => {
      throw new Error('status unavailable')
    }
    const warn = vi.spyOn(refreshStatusLog, 'warn').mockImplementation(() => {})

    await refreshRepoWorktreeStatus({ get: workspacesStore.getState }, REPO_ID, workspaceRuntimeId)

    expect(getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)).toBe(acceptedStatus)
    expect(warn).toHaveBeenCalledWith('failed', expect.objectContaining({ err: expect.any(Error) }))
  })

  test('does not request status for a stale workspace runtime', async () => {
    seedRepo([branch('main')], 'repo-runtime-current')
    const handler = vi.fn()
    ipcHandlers['repo.worktreeStatus'] = handler

    await refreshRepoWorktreeStatus({ get: workspacesStore.getState }, REPO_ID, 'repo-runtime-stale')

    expect(handler).not.toHaveBeenCalled()
  })
})
