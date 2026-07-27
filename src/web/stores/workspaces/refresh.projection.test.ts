import { CancelledError } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { emptyWorkspace, replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { refreshStatusLog } from '#/web/logger.ts'
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

describe('workspace refresh projection', () => {
  test('projection read-model refresh updates the repo read model and visible status via the projection endpoint', async () => {
    const workspaceRuntimeId = seedRepo([branch('old')])
    let projectionCalls = 0
    ipcHandlers['repo.projection'] = async () => {
      projectionCalls += 1
      return {
        snapshot: { branches: [branch('main')], current: 'main' },
        pullRequests: null,
        requested: { branch: null, pullRequestMode: 'full' },
        loadedAt: 123,
      }
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(projectionCalls).toBe(1)
    expect(repoBranchNames()).toEqual(['main'])
  })

  test('projection read-model refresh writes the server projection result into repo data query cache', async () => {
    const workspaceRuntimeId = seedRepo([branch('old')])
    const snapshot = { branches: [branch('main')], current: 'main' }
    const projection = {
      snapshot,
      pullRequests: null,
      requested: { branch: null, pullRequestMode: 'full' as const },
      loadedAt: 123,
    }
    ipcHandlers['repo.projection'] = async () => projection
    const statusRead = vi.fn()
    ipcHandlers['repo.worktreeStatus'] = statusRead

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(
      primaryWindowQueryClient.getQueryData(repoProjectionQueryKey(REPO_ID, workspaceRuntimeId, null, 'full')),
    ).toEqual(projection)
    expect(statusRead).not.toHaveBeenCalled()
  })

  test('projection read-model refresh drops stale results when the repo is reopened during a projection read', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')], 'repo-runtime-test')
    primaryWindowQueryClient.removeQueries({ queryKey: repoDataQueryKey(REPO_ID, workspaceRuntimeId) })
    ipcHandlers['repo.projection'] = async () => {
      // Reopen the repo while the projection is in flight. With the new
      // atomic flow the snapshot result is stale and should be dropped
      // (the new runtime keeps its own data).
      seedRepo([branch('reopened')], 'repo-runtime-test-2')
      return {
        snapshot: { branches: [branch('stale')], current: 'stale' },
        pullRequests: null,
        requested: { branch: null, pullRequestMode: 'full' },
        loadedAt: 123,
      }
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(repo ? readRepoBranchQueryProjection(repo)?.branches.map((b) => b.name) : null).toEqual(['reopened'])
  })

  test('projection read-model refresh keeps the workspace available when Git capability is unavailable', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    let projectionCalls = 0
    ipcHandlers['repo.projection'] = async () => {
      projectionCalls += 1
      throw new Error('error.workspace-git-unavailable')
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(projectionCalls).toBe(1)
    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.capability.kind).toBe('git')
    expect(requireGitWorkspaceForTest(repo).capability.git.dataLoads.repoReadModel.error).toBe(
      'error.workspace-git-unavailable',
    )
  })

  test('projection failure does not start a compensating status refresh', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    ipcHandlers['repo.projection'] = async () => {
      throw new Error('projection failed')
    }
    const statusRead = vi.fn()
    ipcHandlers['repo.worktreeStatus'] = statusRead

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(requireGitWorkspaceForTest(repo).capability.git.dataLoads.repoReadModel).toMatchObject({
      phase: 'idle',
      error: 'projection failed',
    })
    expect(statusRead).not.toHaveBeenCalled()
  })

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

  test('repo read-model projection refresh writes the server snapshot result into repo data query cache', async () => {
    const workspaceRuntimeId = seedRepo([branch('old')])
    const snapshot = { branches: [branch('main')], current: 'main' }
    ipcHandlers['repo.projection'] = async () => repoProjection(snapshot)

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(cachedRepoProjection(workspaceRuntimeId)?.snapshot).toEqual(snapshot)
  })

  test('projection read-model refresh drops status when the repo is reopened before the projection settles', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')], 'repo-runtime-test')
    ipcHandlers['repo.projection'] = async () => {
      // projection returns valid snapshot, but the repo is reopened
      // before the apply step. Both branches get dropped.
      seedRepo([branch('reopened')], 'repo-runtime-test-2')
      return { snapshot: { branches: [branch('main')], current: 'main' }, pullRequests: null }
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(repo ? readRepoBranchQueryProjection(repo)?.branches.map((b) => b.name) : null).toEqual(['reopened'])
  })

  test('repo read-model projection refresh keeps status-derived worktree dirtiness authoritative', async () => {
    const workspaceRuntimeId = seedRepo(
      [
        branch('feature/a', undefined, {
          worktree: {
            path: '/tmp/worktree-a',
          },
        }),
      ],
      'repo-runtime-test',
    )
    seedRepoReadModelQueryData(
      { id: REPO_ID, workspaceRuntimeId: workspaceRuntimeId },
      {
        branches: [
          branch('feature/a', undefined, {
            worktree: {
              path: '/tmp/worktree-a',
            },
          }),
        ],
        currentBranch: 'feature/a',
        status: [{ path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [] }],
      },
    )
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [
          branch('feature/a', undefined, {
            worktree: {
              path: '/tmp/worktree-a',
            },
          }),
        ],
        current: 'feature/a',
      })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(readRepoBranchQueryProjection(repo)?.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
  })

  test('cancels projection data-load state when a read is cancelled without a successor', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    ipcHandlers['repo.projection'] = async () => {
      throw new CancelledError()
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads
        .repoReadModel,
    ).toMatchObject({
      phase: 'idle',
      error: null,
    })
  })

  test('coalesces concurrent repo read-model projection refreshes for the same workspace runtime', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    ipcHandlers['repo.projection'] = () => {
      callCount += 1
      return new Promise((resolve) => {
        const complete = (snapshot: { branches: ReturnType<typeof branch>[]; current: string }) =>
          resolve(repoProjection(snapshot))
        resolveFirst = complete
      })
    }

    const first = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    const second = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    await vi.waitFor(() => {
      expect(callCount).toBe(1)
    })
    resolveFirst({ branches: [branch('fresh')], current: 'fresh' })
    await Promise.all([first, second])
    expect(repoCurrentBranch()).toBe('fresh')
  })

  test('repo read-model projection refresh preserves the terminal preference when the selected branch has no worktree', async () => {
    // The store never re-projects the preferred tab. Whether the terminal
    // tab is renderable is decided at read time by the workspace pane tab
    // model, which inspects the active branch's worktree + terminal session count.
    const workspaceRuntimeId = seedRepo([
      branch('main', undefined, { worktree: { path: '/repo' } }),
      branch('feature/a'),
    ])
    updateRepoForTest((repo) => {
      repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        repo.ui,
        { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/a' },
        'terminal',
      )
    })
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    const projection = repo ? readRepoBranchQueryProjection(repo) : null
    expect(
      repo && projection
        ? preferredWorkspacePaneTabForTarget(
            repo.ui,
            workspacePaneTabsTargetForRepoBranch({ workspaceId: repo.id, branches: projection.branches }, 'feature/a'),
          )
        : null,
    ).toBe('terminal')
  })

  test('repo read-model projection refresh follows selected worktree using the previous query projection', async () => {
    const workspaceRuntimeId = seedRepo([
      branch('feature/old', undefined, { worktree: { path: '/tmp/worktree-a' } }),
      branch('feature/new'),
    ])
    updateRepoForTest((repo) => {
      repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        repo.ui,
        { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: '/tmp/worktree-a' },
        'terminal',
      )
    })
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [branch('feature/old'), branch('feature/new', undefined, { worktree: { path: '/tmp/worktree-a' } })],
        current: 'feature/new',
      })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    const projection = repo ? readRepoBranchQueryProjection(repo) : null
    expect(
      repo && projection
        ? preferredWorkspacePaneTabForTarget(
            repo.ui,
            workspacePaneTabsTargetForRepoBranch(
              { workspaceId: repo.id, branches: projection.branches },
              'feature/new',
            ),
          )
        : null,
    ).toBe('terminal')
  })

})
