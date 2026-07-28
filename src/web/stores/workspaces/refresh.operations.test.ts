import { seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
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
  createWorktreeAction,
} from '#/web/stores/workspaces/refresh-test-utils.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
beforeEach(resetRefreshTest)

describe('workspace refresh operations', () => {
  test('manual refresh skips repo.fetch for local-only repositories and refreshes local state', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch('feature/a')],
      remote: {
        hasRemotes: false,
        hasBrowserRemote: false,
        hasGitHubRemote: false,
        remotes: [],
        remoteDetails: [],
        remoteProviders: {},
      },
    })
    let fetchCount = 0
    let snapshotCount = 0
    let statusCount = 0
    ipcHandlers['repo.fetch'] = async () => {
      fetchCount += 1
      return { ok: true, message: 'ok' }
    }
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return {
        snapshot: { branches: [branch('feature/a')], current: 'feature/a' },
        pullRequests: null,
      }
    }
    ipcHandlers['repo.worktreeStatus'] = ({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => {
      statusCount += 1
      return { workspaceRuntimeId, status: [], loadedAt: Date.now() }
    }

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, {
      workspaceRuntimeId: useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId,
    })

    expect(fetchCount).toBe(0)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
  })

  test('manual sync records the remote fetch settled time', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    const before = Date.now()

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads.fetch
        .loadedAt,
    ).toBeGreaterThanOrEqual(before)
  })

  test('manual sync ignores stale fetch results after repo reopen', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const workspaceRuntimeId = seedRepo([branch('main')], 'repo-runtime-test')
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [branch('feature/reopened')],
        current: 'feature/reopened',
      })

    const work = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => {
      expect(resolveFetch).toEqual(expect.any(Function))
    })
    seedRepo([branch('main')], 'repo-runtime-test-2')
    resolveFetch({ ok: true, message: 'ok' })
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(requireGitWorkspaceForTest(repo).capability.git.events).toEqual([])
    expect(requireGitWorkspaceForTest(repo).capability.git.dataLoads.fetch.loadedAt).toBeNull()
  })

  test('network operations expose repo-level fetch busy state', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let resolveNetwork!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveNetwork = resolve
      })

    const work = runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    await vi.waitFor(() => {
      expect(resolveNetwork).toEqual(expect.any(Function))
    })
    const runningRepo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(runningRepo).capability.git.dataLoads.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveNetwork({ ok: true, message: 'ok' })
    await work

    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads.fetch
        .phase,
    ).toBe('idle')
  })

  test('manual sync records failed fetch results and still refreshes local state', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.fetch'] = async () => ({ ok: false, message: 'fatal: rejected' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'fatal: rejected' },
    })
    expect(snapshotCount).toBe(1)
  })

  test('manual sync refreshes fetch, snapshot, and status without implicit pull request summary backfill', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let fetchCount = 0
    let snapshotCount = 0
    let statusCount = 0
    ipcHandlers['repo.fetch'] = async () => {
      fetchCount += 1
      return { ok: true, message: 'ok' }
    }
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      statusCount += 1
      return repoProjection({ branches: [branch('feature/a'), branch('feature/b')], current: 'feature/a' })
    }

    await runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await waitForNextMacrotask()

    expect(fetchCount).toBe(1)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
    expect(repoBranchNames()).toEqual(['feature/a', 'feature/b'])
  })

  test('manual sync records thrown fetch failures instead of rejecting', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    ipcHandlers['repo.fetch'] = async () => {
      throw new Error('network down')
    }

    await expect(runManualWorkspaceRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })).resolves.toEqual({
      ok: true,
    })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'network down' },
    })
    expect(requireGitWorkspaceForTest(repo).capability.git.dataLoads.fetch.phase).toBe('idle')
  })

  test('branch network actions expose branch and fetch operation state', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let resolvePull!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.pull'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolvePull = resolve
      })

    const work = useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { workspaceRuntimeId })

    const runningRepo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(runningRepo).capability.git.operations.branchAction.phase).toBe('running')
    expect(requireGitWorkspaceForTest(runningRepo).capability.git.dataLoads.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolvePull({ ok: true, message: 'ok' })
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.operations.branchAction.phase).toBe('idle')
    expect(requireGitWorkspaceForTest(repo).capability.git.dataLoads.fetch.phase).toBe('idle')
  })

  test('branch write actions rely on server invalidation after completion', async () => {
    const workspaceRuntimeId = seedRepo([branch('main'), branch('feature/a')])
    let resolveDelete!: (value: { ok: true; message: string }) => void
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveDelete = resolve
      })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main')], current: 'main' })
    }

    const work = useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'deleteBranch', branch: 'feature/a' }, { workspaceRuntimeId })

    const runningRepo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(runningRepo).capability.git.operations.branchAction.phase).toBe('running')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveDelete({ ok: true, message: 'ok' })
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.operations.branchAction.phase).toBe('idle')
    expect(repoBranchNames()).toEqual(['main', 'feature/a'])
    expect(snapshotCount).toBe(0)
  })

  test('create worktree runs through branch operation state and refreshes only after success', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({ ok: true, message: 'ok' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main'), branch('feature/a')], current: 'main' })
    }

    const result = await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(requireGitWorkspaceForTest(repo).capability.git.operations.branchAction.phase).toBe('idle')
    expect(repoBranchNames()).toEqual(['main', 'feature/a'])
    expect(snapshotCount).toBe(1)
  })

  test('create worktree failure does not refresh when requested by command caller', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({ ok: false, message: 'error.invalid-path' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main'), branch('feature/a')], current: 'main' })
    }

    const result = await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(snapshotCount).toBe(0)
  })

  test('create worktree partial failure relies on server invalidation', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({
      ok: false,
      message: 'Worktree bootstrap failed: setup failed',
      repositoryStateChanged: true,
    })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main'), branch('feature/a')], current: 'main' })
    }

    const result = await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: setup failed',
      repositoryStateChanged: true,
    })
    expect(snapshotCount).toBe(0)
    expect(repoBranchNames()).toEqual(['main'])
  })

  test('deferred branch action results skip toast and refresh until caller confirms follow-up', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = async () => ({ ok: false, message: 'error.branch-not-fully-merged' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    const result = await useWorkspacesStore
      .getState()
      .runBranchAction(
        REPO_ID,
        { kind: 'deleteBranch', branch: 'feature/a' },
        { workspaceRuntimeId, deferResultMessages: ['error.branch-not-fully-merged'] },
      )

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(result).toEqual({ ok: false, message: 'error.branch-not-fully-merged' })
    expect(requireGitWorkspaceForTest(repo).capability.git.events).toEqual([])
    expect(snapshotCount).toBe(0)
    expect(requireGitWorkspaceForTest(repo).capability.git.operations.branchAction.phase).toBe('idle')
  })

  test('branch action failures do not issue a client completion refresh', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = async () => ({ ok: false, message: 'error.delete-branch-failed' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    const result = await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'deleteBranch', branch: 'feature/a' }, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(result).toEqual({ ok: false, message: 'error.delete-branch-failed' })
    expect(requireGitWorkspaceForTest(repo).capability.git.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.delete-branch-failed' },
    })
    expect(snapshotCount).toBe(0)
  })

  test('failed network branch actions do not clear the sticky fetch failure badge', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    updateRepoForTest((repo) => {
      const remote = requireGitWorkspaceForTest(repo).capability.git.remote
      remote.fetchFailed = true
      remote.fetchError = 'previous failure'
    })
    ipcHandlers['repo.pull'] = async () => ({ ok: false, message: 'fatal: rejected' })

    await useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { workspaceRuntimeId })

    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.remote,
    ).toMatchObject({
      fetchFailed: true,
      fetchError: 'previous failure',
    })
    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.operations
        .branchAction,
    ).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
      target: null,
    })
    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[REPO_ID]).capability.git.dataLoads.fetch,
    ).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
    })
  })

  test('remove worktree delegates terminal cleanup to the native host action', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a', undefined, { worktree: { path: '/tmp/worktree-a' } })])
    const calls: string[] = []
    ipcHandlers['repo.removeWorktree'] = async () => {
      calls.push('removeWorktree')
      return { ok: true, message: 'ok' }
    }

    await useWorkspacesStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'removeWorktree',
        branch: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        deleteBranch: false,
        forceDeleteBranch: false,
      },
      { workspaceRuntimeId },
    )

    expect(calls).toEqual(['removeWorktree'])
  })
})
