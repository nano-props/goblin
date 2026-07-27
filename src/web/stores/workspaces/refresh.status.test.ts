import { CancelledError } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { emptyWorkspace, replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { refreshStatusLog, terminalLog } from '#/web/logger.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import { runManualWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import {
  branch,
  REPO_ID,
  resetRefreshTest,
  ipcHandlers,
  seedRepo,
  repoProjection,
  refreshStoreAccess,
  updateRepoForTest,
  repoBranchNames,
  repoCurrentBranch,
  cachedRepoProjection,
  cachedRepoStatus,
  createWorktreeAction,
} from '#/web/stores/workspaces/refresh-test-utils.ts'
import { seedRepoReadModelQueryData, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey, repoProjectionQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import {
  getRepoWorktreeStatusQueryData,
  setRepoProjectionQueryData,
  setRepoWorktreeStatusQueryData,
} from '#/web/repo-query-cache.ts'
import { repoProjectionQueryOptions, repoWorktreeStatusQueryOptions } from '#/web/repo-query-options.ts'
import { invalidateRepoSnapshotQueries } from '#/web/repo-query-runtime.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { WorkspaceRefreshResult } from '#/shared/workspace-runtime.ts'
import type { WorktreeStatus } from '#/web/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
beforeEach(resetRefreshTest)

describe('workspace refresh status', () => {
  test('standalone status errors remain query-local', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    ipcHandlers['repo.worktreeStatus'] = async () => {
      throw new Error('error.workspace-git-unavailable')
    }

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.capability.kind).toBe('git')
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error,
    ).toEqual(
      expect.objectContaining({
        message: 'error.failed-read-repo',
        cause: expect.objectContaining({ message: 'error.workspace-git-unavailable' }),
      }),
    )
  })

  test('coalesces concurrent visible status refreshes for the same workspace runtime', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: WorktreeStatus[]) => void
    ipcHandlers['repo.projection'] = () => repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    ipcHandlers['repo.worktreeStatus'] = () => {
      callCount += 1
      return new Promise((resolve) => {
        const complete = (status: WorktreeStatus[]) => resolve({ workspaceRuntimeId, status, loadedAt: Date.now() })
        resolveFirst = complete
      })
    }

    const first = refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    const second = refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    let secondSettled = false
    void second.then(() => {
      secondSettled = true
    })
    const fresh = [{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] }]

    await vi.waitFor(() => {
      expect(callCount).toBe(1)
    })
    expect(secondSettled).toBe(false)
    resolveFirst(fresh)
    await Promise.all([first, second])
    expect(secondSettled).toBe(true)
    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual(fresh)
  })

  test('status refresh updates normalized worktree dirty metadata in the branch read model', async () => {
    const workspaceRuntimeId = seedRepo([
      branch('feature/cleaned', undefined, {
        worktree: {
          path: '/tmp/worktree-cleaned',
          summary: {
            dirty: true,
            changeCount: 2,
          },
        },
      }),
      branch('feature/dirty', undefined, {
        worktree: {
          path: '/tmp/worktree-dirty',
          summary: {
            dirty: false,
            changeCount: 0,
          },
        },
      }),
      branch('feature/missing', undefined, {
        worktree: {
          path: '/tmp/worktree-missing',
          summary: {
            dirty: true,
            changeCount: 3,
          },
        },
      }),
    ])
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [
          branch('feature/cleaned', undefined, {
            worktree: {
              path: '/tmp/worktree-cleaned',
              summary: {
                dirty: true,
                changeCount: 2,
              },
            },
          }),
          branch('feature/dirty', undefined, {
            worktree: {
              path: '/tmp/worktree-dirty',
              summary: {
                dirty: false,
                changeCount: 0,
              },
            },
          }),
          branch('feature/missing', undefined, {
            worktree: {
              path: '/tmp/worktree-missing',
              summary: {
                dirty: true,
                changeCount: 3,
              },
            },
          }),
        ],
        current: '',
      })
    ipcHandlers['repo.worktreeStatus'] = () => ({
      workspaceRuntimeId,
      status: [
        { path: '/tmp/worktree-cleaned', branch: 'feature/cleaned', isMain: false, entries: [] },
        {
          path: '/tmp/worktree-dirty',
          branch: 'feature/dirty',
          isMain: false,
          entries: [
            { x: 'M', y: ' ', path: 'one.ts' },
            { x: '?', y: '?', path: 'two.ts' },
          ],
        },
      ],
      loadedAt: Date.now(),
    })

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    const worktreesByPath = readRepoBranchQueryProjection(repo)?.worktreesByPath
    expect(worktreesByPath?.['/tmp/worktree-cleaned']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
    expect(worktreesByPath?.['/tmp/worktree-dirty']).toMatchObject({
      isDirty: true,
      changeCount: 2,
    })
    expect(worktreesByPath?.['/tmp/worktree-missing']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
  })

  test('status refresh writes the server result into repo data query cache', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    const status: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
    ]
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    ipcHandlers['repo.worktreeStatus'] = () => ({ workspaceRuntimeId, status, loadedAt: Date.now() })

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual(status)
  })

  test('status refresh replaces the normalized repo-runtime status result', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    const staleStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'stale.ts' }] },
    ]
    setRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId, {
      workspaceRuntimeId,
      status: staleStatus,
      loadedAt: 1,
    })
    const freshStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] },
    ]
    setRepoProjectionQueryData(
      REPO_ID,
      workspaceRuntimeId,
      'feature/a',
      'full',
      repoProjection(
        { branches: [branch('feature/a')], current: 'feature/a' },
        {
          requested: { branch: 'feature/a', pullRequestMode: 'full' },
        },
      ),
    )
    setRepoProjectionQueryData(
      REPO_ID,
      workspaceRuntimeId,
      null,
      'full',
      repoProjection({ branches: [branch('feature/a')], current: 'feature/a' }),
    )
    ipcHandlers['repo.projection'] = async (input) => {
      expect(input).toMatchObject({ cwd: REPO_ID, branch: 'feature/a', mode: 'full' })
      return repoProjection(
        { branches: [branch('feature/a')], current: 'feature/a' },
        {
          requested: { branch: 'feature/a', pullRequestMode: 'full' },
        },
      )
    }
    ipcHandlers['repo.worktreeStatus'] = () => ({ workspaceRuntimeId, status: freshStatus, loadedAt: Date.now() })

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual(freshStatus)
  })

  test('workspace visible status cache refresh writes branch-scoped results without invalidating active queries', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    const staleStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'stale.ts' }] },
    ]
    setRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId, {
      workspaceRuntimeId,
      status: staleStatus,
      loadedAt: 1,
    })
    const freshStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] },
    ]
    setRepoProjectionQueryData(
      REPO_ID,
      workspaceRuntimeId,
      'feature/a',
      'full',
      repoProjection(
        { branches: [branch('feature/a')], current: 'feature/a' },
        {
          requested: { branch: 'feature/a', pullRequestMode: 'full' },
        },
      ),
    )
    ipcHandlers['repo.worktreeStatus'] = () => ({ workspaceRuntimeId, status: freshStatus, loadedAt: Date.now() })

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId), exact: true, refetchType: 'none' },
      { cancelRefetch: false },
    )
    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual(freshStatus)
  })

  test('workspace visible status cache refresh drops stale results after projection invalidation', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let statusCalls = 0
    let resolveStatus!: (snapshot: { workspaceRuntimeId: string; status: WorktreeStatus[]; loadedAt: number }) => void
    const staleStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'stale.ts' }] },
    ]
    const newerStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'newer.ts' }] },
    ]
    ipcHandlers['repo.worktreeStatus'] = async () => {
      statusCalls += 1
      if (statusCalls > 1) return { workspaceRuntimeId, status: newerStatus, loadedAt: Date.now() }
      return await new Promise((resolve) => {
        resolveStatus = resolve
      })
    }

    const refresh = refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    await vi.waitFor(() => {
      expect(statusCalls).toBe(1)
    })
    invalidateRepoSnapshotQueries(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)
    resolveStatus({ workspaceRuntimeId, status: staleStatus, loadedAt: Date.now() })
    await refresh

    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual(newerStatus)
  })

  test('workspace visible status cache refresh drops stale errors after projection invalidation', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let statusCalls = 0
    let rejectStatus!: (err: Error) => void
    ipcHandlers['repo.worktreeStatus'] = async () => {
      statusCalls += 1
      if (statusCalls > 1) return { workspaceRuntimeId, status: [], loadedAt: Date.now() }
      return await new Promise((_resolve, reject) => {
        rejectStatus = reject
      })
    }

    const refresh = refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    await vi.waitFor(() => {
      expect(statusCalls).toBe(1)
    })
    invalidateRepoSnapshotQueries(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)

    rejectStatus(new Error('error.path-not-found'))
    await refresh

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(repo.capability.kind).toBe('git')
    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual([])
  })

  test('workspace status refresh requires a current runtime with Git capability', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let statusCalls = 0
    ipcHandlers['repo.worktreeStatus'] = ({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => {
      statusCalls += 1
      return { workspaceRuntimeId, status: [], loadedAt: Date.now() }
    }

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, 'repo-runtime-stale')
    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    updateRepoForTest((repo) => {
      acceptWorkspaceProbeState(repo, {
        status: 'unavailable',
        reason: 'error.workspace-path-not-found',
      })
    })
    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    updateRepoForTest((repo) => {
      acceptWorkspaceProbeState(repo, {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      })
    })
    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(statusCalls).toBe(1)
  })

  test('workspace visible status cache refresh joins an active matching status fetch', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId) })
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    let statusCalls = 0
    let resolveStatus!: (snapshot: { workspaceRuntimeId: string; status: WorktreeStatus[]; loadedAt: number }) => void
    const activeStatus: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'active.ts' }] },
    ]
    ipcHandlers['repo.worktreeStatus'] = () => {
      statusCalls += 1
      return new Promise((resolve) => {
        resolveStatus = resolve
      })
    }

    const activeFetch = primaryWindowQueryClient.fetchQuery(repoWorktreeStatusQueryOptions(REPO_ID, workspaceRuntimeId))
    await vi.waitFor(() => {
      expect(statusCalls).toBe(1)
    })

    const visibleRefresh = refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(statusCalls).toBe(1)
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId), exact: true, refetchType: 'none' },
      { cancelRefetch: false },
    )
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.fetchStatus,
    ).toBe('fetching')

    resolveStatus({ workspaceRuntimeId, status: activeStatus, loadedAt: Date.now() })
    await Promise.all([activeFetch, visibleRefresh])
    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual(activeStatus)
  })

  test('status query records fetching, success, and stale error state', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let resolveStatus!: (value: WorktreeStatus[]) => void
    const status: WorktreeStatus[] = [{ path: '/tmp/goblin-test-repo', branch: 'feature/a', isMain: true, entries: [] }]
    ipcHandlers['repo.projection'] = () => repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    ipcHandlers['repo.worktreeStatus'] = () =>
      new Promise((resolve) => {
        resolveStatus = (status) => resolve({ workspaceRuntimeId, status, loadedAt: Date.now() })
      })

    const work = refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    await vi.waitFor(() => {
      expect(resolveStatus).toEqual(expect.any(Function))
    })
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId)),
    ).toMatchObject({
      fetchStatus: 'fetching',
      error: null,
    })
    resolveStatus(status)
    await work

    const loadedAt = getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.loadedAt
    expect(loadedAt).toEqual(expect.any(Number))
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId)),
    ).toMatchObject({
      fetchStatus: 'idle',
      error: null,
    })

    ipcHandlers['repo.worktreeStatus'] = async () => {
      throw new Error('status failed')
    }

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.loadedAt).toBe(loadedAt)
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error,
    ).toEqual(
      expect.objectContaining({
        message: 'error.failed-read-repo',
        cause: expect.objectContaining({ message: 'status failed' }),
      }),
    )
  })

  test('treats query cancellation as a lifecycle outcome rather than a status failure', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    const warn = vi.spyOn(refreshStatusLog, 'warn')
    vi.spyOn(primaryWindowQueryClient, 'fetchQuery').mockRejectedValueOnce(new CancelledError())

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(warn).not.toHaveBeenCalled()
  })
})
