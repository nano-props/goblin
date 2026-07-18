import { CancelledError } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { refreshStatusLog, terminalLog } from '#/web/logger.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { requestRepoProjectionReadModelRefresh, runManualRepoSync } from '#/web/stores/workspaces/refresh.ts'
import {
  branch,
  REPO_ID,
  resetRefreshTest,
  ipcHandlers,
  seedRepo,
  repoProjection,
} from '#/web/stores/workspaces/refresh-test-utils.ts'
import { seedRepoReadModelQueryData, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { canStartRemoteFetch } from '#/web/stores/workspaces/sync-state.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  markRepoRuntimeProjectionInvalidated,
  getRepoWorktreeStatusQueryData,
  repoDataQueryKey,
  repoProjectionQueryKey,
  repoProjectionQueryOptions,
  repoWorktreeStatusQueryKey,
  repoWorktreeStatusQueryOptions,
  setRepoProjectionQueryData,
  setRepoWorktreeStatusQueryData,
} from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { WorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/web/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
beforeEach(resetRefreshTest)

type TestRepo = NonNullable<ReturnType<typeof useWorkspacesStore.getState>['workspaces'][string]>
type TestCreateWorktreeAction = Parameters<ReturnType<typeof useWorkspacesStore.getState>['runBranchAction']>[1]

const refreshStoreAccess = { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState }

function updateRepoForTest(mutator: (repo: TestRepo) => void) {
  useWorkspacesStore.setState((s) => {
    const repo = s.workspaces[REPO_ID]
    if (!repo) return s
    return { workspaces: { ...s.workspaces, [REPO_ID]: replaceWorkspace(repo, mutator) } }
  })
}

function repoBranchNames(): string[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.branches.map((branch) => branch.name) ?? []) : []
}

function repoCurrentBranch(): string | null {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.currentBranch ?? null) : null
}

function cachedRepoProjection(
  workspaceRuntimeId: string,
  branchName: string | null = null,
): WorkspaceRuntimeProjection | undefined {
  return primaryWindowQueryClient.getQueryData<WorkspaceRuntimeProjection>(
    repoProjectionQueryKey(REPO_ID, workspaceRuntimeId, branchName, 'full'),
  )
}

function cachedRepoStatus(workspaceRuntimeId: string): WorktreeStatus[] | undefined {
  return getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)?.status
}

function createWorktreeAction(): TestCreateWorktreeAction {
  return {
    kind: 'createWorktree',
    input: {
      worktreePath: '/tmp/worktrees/feature-a',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    },
    worktreeBootstrap: { kind: 'skip' },
  }
}

describe('remote fetch timestamps', () => {
  test('commits a non-Git capability transition without changing the runtime or reading Git state', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    const fetch = vi.fn()
    const projection = vi.fn()
    ipcHandlers['repo.fetch'] = fetch
    ipcHandlers['repo.projection'] = projection
    ipcHandlers['workspace.refresh'] = () => ({
      kind: 'committed',
      probe: {
        status: 'ready',
        name: 'workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })

    await runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe(workspaceRuntimeId)
    expect(repo?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(projection).not.toHaveBeenCalled()
  })

  test('failed Refresh Workspace preserves the last committed capability and Git projection', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    updateRepoForTest((repo) => {
      repo.workspaceProbe = {
        status: 'ready',
        name: 'workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      }
    })
    const before = useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceProbe
    const fetch = vi.fn()
    const projection = vi.fn()
    ipcHandlers['repo.fetch'] = fetch
    ipcHandlers['repo.projection'] = projection
    ipcHandlers['workspace.refresh'] = () => ({
      kind: 'failed',
      probe: {
        status: 'ready',
        name: 'workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [{ scope: 'git', message: 'git timed out' }],
      },
    })

    await runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceProbe).toBe(before)
    expect(fetch).not.toHaveBeenCalled()
    expect(projection).not.toHaveBeenCalled()
  })

  test('repo read-model projection refresh treats query projection branches as existing data while loading', async () => {
    const workspaceRuntimeId = seedRepo([])
    seedRepoReadModelQueryData(
      { id: REPO_ID, workspaceRuntimeId: workspaceRuntimeId },
      {
        branches: [branch('feature/query')],
        currentBranch: 'feature/query',
      },
    )
    let resolveSnapshot!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    ipcHandlers['repo.projection'] = () =>
      new Promise((resolve) => {
        resolveSnapshot = (snapshot) => resolve(repoProjection(snapshot))
      })

    const work = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => {
      expect(resolveSnapshot).toEqual(expect.any(Function))
    })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.dataLoads.repoReadModel.phase).toBe('refreshing')

    resolveSnapshot({ branches: [branch('feature/query')], current: 'feature/query' })
    await work
  })

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

    await runManualRepoSync(refreshStoreAccess, REPO_ID, {
      workspaceRuntimeId: useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId,
    })

    expect(fetchCount).toBe(0)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
  })

  test('manual sync records the remote fetch settled time', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    const before = Date.now()

    await runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.dataLoads.fetch.loadedAt).toBeGreaterThanOrEqual(before)
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

    const work = runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await vi.waitFor(() => {
      expect(resolveFetch).toEqual(expect.any(Function))
    })
    seedRepo([branch('main')], 'repo-runtime-test-2')
    resolveFetch({ ok: true, message: 'ok' })
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-test-2')
    expect(repo?.events).toEqual([])
    expect(repo?.dataLoads.fetch.loadedAt).toBeNull()
  })

  test('network operations expose repo-level fetch busy state', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let resolveNetwork!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveNetwork = resolve
      })

    const work = runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    await vi.waitFor(() => {
      expect(resolveNetwork).toEqual(expect.any(Function))
    })
    const runningRepo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(runningRepo?.dataLoads.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveNetwork({ ok: true, message: 'ok' })
    await work

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.dataLoads.fetch.phase).toBe('idle')
  })

  test('manual sync records failed fetch results and still refreshes local state', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.fetch'] = async () => ({ ok: false, message: 'fatal: rejected' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    await runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'fatal: rejected' } })
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

    await runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchCount).toBe(1)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
  })

  test('manual sync records thrown fetch failures instead of rejecting', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    ipcHandlers['repo.fetch'] = async () => {
      throw new Error('network down')
    }

    await expect(runManualRepoSync(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })).resolves.toBeUndefined()

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'network down' } })
    expect(repo?.dataLoads.fetch.phase).toBe('idle')
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
    expect(runningRepo?.operations.branchAction.phase).toBe('running')
    expect(runningRepo?.dataLoads.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolvePull({ ok: true, message: 'ok' })
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repo?.dataLoads.fetch.phase).toBe('idle')
  })

  test('branch write actions run through branch operation state and refresh after completion', async () => {
    const workspaceRuntimeId = seedRepo([branch('main'), branch('feature/a')])
    let resolveDelete!: (value: { ok: true; message: string }) => void
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveDelete = resolve
      })
    // Post-write branch action refresh goes through the query-backed
    // projection refresh path now.
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main')], current: 'main' })
    }

    const work = useWorkspacesStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'deleteBranch', branch: 'feature/a' }, { workspaceRuntimeId })

    const runningRepo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(runningRepo?.operations.branchAction.phase).toBe('running')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveDelete({ ok: true, message: 'ok' })
    await work

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repoBranchNames()).toEqual(['main'])
    expect(snapshotCount).toBe(1)
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
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId, refreshOnError: false })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(repo?.operations.branchAction.phase).toBe('idle')
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
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId, refreshOnError: false })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(snapshotCount).toBe(0)
  })

  test('create worktree partial failure refreshes when the repository already changed', async () => {
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
      .runBranchAction(REPO_ID, createWorktreeAction(), { workspaceRuntimeId, refreshOnError: false })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: setup failed',
      repositoryStateChanged: true,
    })
    expect(snapshotCount).toBe(1)
    expect(repoBranchNames()).toEqual(['main', 'feature/a'])
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
    expect(repo?.events).toEqual([])
    expect(snapshotCount).toBe(0)
    expect(repo?.operations.branchAction.phase).toBe('idle')
  })

  test('branch action failures refresh by default', async () => {
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
    expect(repo?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.delete-branch-failed' },
    })
    expect(snapshotCount).toBe(1)
  })

  test('failed network branch actions do not clear the sticky fetch failure badge', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.remote.fetchFailed = true
      repo.remote.fetchError = 'previous failure'
    })
    ipcHandlers['repo.pull'] = async () => ({ ok: false, message: 'fatal: rejected' })

    await useWorkspacesStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { workspaceRuntimeId })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.remote).toMatchObject({
      fetchFailed: true,
      fetchError: 'previous failure',
    })
    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
      target: null,
    })
    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.dataLoads.fetch).toMatchObject({
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

describe('projection refresh request ordering', () => {
  test('projection read-model refresh updates the repo read model and visible status via the projection endpoint', async () => {
    const workspaceRuntimeId = seedRepo([branch('old')])
    let projectionCalls = 0
    ipcHandlers['repo.projection'] = async () => {
      projectionCalls += 1
      return {
        snapshot: { branches: [branch('main')], current: 'main' },
        status: [],
        pullRequests: null,
        operations: { operations: [], loadedAt: 123 },
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
    const status: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'main', isMain: true, entries: [{ x: 'M', y: ' ', path: 'src/main.ts' }] },
    ]
    const snapshot = { branches: [branch('main')], current: 'main' }
    const projection = {
      snapshot,
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: null, pullRequestMode: 'full' as const },
      loadedAt: 123,
    }
    ipcHandlers['repo.projection'] = async () => projection
    ipcHandlers['repo.worktreeStatus'] = () => ({ workspaceRuntimeId, status, loadedAt: 456 })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(primaryWindowQueryClient.getQueryData(repoProjectionQueryKey(REPO_ID, workspaceRuntimeId, null, 'full'))).toEqual(
      projection,
    )
    expect(getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.loadedAt).toBe(456)
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
        status: [],
        pullRequests: null,
        operations: { operations: [], loadedAt: 123 },
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
    expect(repo?.availability).toEqual({ phase: 'available' })
    expect(repo?.dataLoads.repoReadModel.error).toBe('error.workspace-git-unavailable')
  })

  test('projection and status refreshes settle independently when projection fails', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    ipcHandlers['repo.projection'] = async () => {
      throw new Error('projection failed')
    }
    ipcHandlers['repo.worktreeStatus'] = () => ({ workspaceRuntimeId, status: [], loadedAt: 456 })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(repo.dataLoads.repoReadModel).toMatchObject({ phase: 'idle', error: 'projection failed' })
    expect(getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.loadedAt).toBe(456)
  })

  test('projection and status refreshes settle independently when status fails', async () => {
    const workspaceRuntimeId = seedRepo([branch('old')])
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({ branches: [branch('main')], current: 'main' }, { loadedAt: 123 })
    ipcHandlers['repo.worktreeStatus'] = async () => {
      throw new Error('status failed')
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(repo.dataLoads.repoReadModel).toMatchObject({ phase: 'idle', error: null, loadedAt: 123 })
    expect(primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error).toEqual(
      expect.objectContaining({
        message: 'error.failed-read-repo',
        cause: expect.objectContaining({ message: 'status failed' }),
      }),
    )
    expect(cachedRepoProjection(workspaceRuntimeId)?.snapshot?.current).toBe('main')
  })

  test.each(['status-first', 'projection-first'] as const)(
    'status availability errors do not race projection ownership when %s completes',
    async (completionOrder) => {
      const workspaceRuntimeId = seedRepo([branch('old')])
      let resolveProjection!: (projection: WorkspaceRuntimeProjection) => void
      let rejectStatus!: (error: Error) => void
      ipcHandlers['repo.projection'] = () =>
        new Promise((resolve) => {
          resolveProjection = resolve
        })
      ipcHandlers['repo.worktreeStatus'] = () =>
        new Promise((_resolve, reject) => {
          rejectStatus = reject
        })

      const refresh = requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
      await vi.waitFor(() => {
        expect(resolveProjection).toEqual(expect.any(Function))
        expect(rejectStatus).toEqual(expect.any(Function))
      })

      if (completionOrder === 'status-first') {
        rejectStatus(new Error('error.path-not-found'))
        await vi.waitFor(() => {
          expect(
            primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error,
          ).toEqual(
            expect.objectContaining({
              message: 'error.failed-read-repo',
              cause: expect.objectContaining({ message: 'error.path-not-found' }),
            }),
          )
        })
        resolveProjection(repoProjection({ branches: [branch('main')], current: 'main' }))
      } else {
        resolveProjection(repoProjection({ branches: [branch('main')], current: 'main' }))
        await vi.waitFor(() => {
          expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.dataLoads.repoReadModel.phase).toBe('idle')
        })
        rejectStatus(new Error('error.path-not-found'))
      }
      await refresh

      expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.availability).toEqual({ phase: 'available' })
      expect(primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error).toEqual(
        expect.objectContaining({
          message: 'error.failed-read-repo',
          cause: expect.objectContaining({ message: 'error.path-not-found' }),
        }),
      )
    },
  )

  test('standalone status availability errors remain query-local', async () => {
    const workspaceRuntimeId = seedRepo([branch('main')])
    ipcHandlers['repo.worktreeStatus'] = async () => {
      throw new Error('error.workspace-git-unavailable')
    }

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.availability).toEqual({ phase: 'available' })
    expect(primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error).toEqual(
      expect.objectContaining({
        message: 'error.failed-read-repo',
        cause: expect.objectContaining({ message: 'error.workspace-git-unavailable' }),
      }),
    )
  })

  test('repo read-model projection refresh restores an unavailable repo when the path is a git repo again', async () => {
    const workspaceRuntimeId = seedRepo([branch('old')])
    updateRepoForTest((repo) => {
      repo.availability = { phase: 'unavailable', reason: 'error.path-not-found', checkedAt: Date.now() }
    })
    ipcHandlers['repo.projection'] = async () => repoProjection({ branches: [branch('main')], current: 'main' })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(repo?.availability).toEqual({ phase: 'available' })
    expect(repoBranchNames()).toEqual(['main'])
    expect(repo?.dataLoads.repoReadModel.error).toBeNull()
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
    markRepoRuntimeProjectionInvalidated(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)
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
    markRepoRuntimeProjectionInvalidated(REPO_ID, workspaceRuntimeId, primaryWindowQueryClient)

    rejectStatus(new Error('error.path-not-found'))
    await refresh

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    expect(repo.availability.phase).toBe('available')
    expect(cachedRepoStatus(workspaceRuntimeId)).toEqual([])
  })

  test('workspace status refresh guards stale runtimes and unavailable repos', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    let statusCalls = 0
    ipcHandlers['repo.worktreeStatus'] = ({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => {
      statusCalls += 1
      return { workspaceRuntimeId, status: [], loadedAt: Date.now() }
    }

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, 'repo-runtime-stale')
    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)
    updateRepoForTest((repo) => {
      repo.availability = { phase: 'unavailable', reason: 'error.path-not-found', checkedAt: 1 }
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

  test('repo read-model projection refresh keeps status-derived worktree dirtiness authoritative', async () => {
    const workspaceRuntimeId = seedRepo(
      [
        branch('feature/a', undefined, {
          worktree: {
            path: '/tmp/worktree-a',
            summary: {
              dirty: false,
              changeCount: 0,
            },
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
              summary: {
                dirty: false,
                changeCount: 0,
              },
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
              summary: {
                dirty: true,
                changeCount: 4,
              },
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

  test('repo read-model projection refresh does not use snapshot dirty summary without status', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [
          branch('feature/a', undefined, {
            worktree: {
              path: '/tmp/worktree-a',
              summary: {
                dirty: true,
                changeCount: 3,
              },
            },
          }),
        ],
        current: 'feature/a',
      })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    const projection = repo ? readRepoBranchQueryProjection(repo) : null
    expect(projection?.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(projection?.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
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
    expect(primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))).toMatchObject({
      fetchStatus: 'fetching',
      error: null,
    })
    resolveStatus(status)
    await work

    const loadedAt = getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.loadedAt
    expect(loadedAt).toEqual(expect.any(Number))
    expect(primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))).toMatchObject({
      fetchStatus: 'idle',
      error: null,
    })

    ipcHandlers['repo.worktreeStatus'] = async () => {
      throw new Error('status failed')
    }

    await refreshRepoWorktreeStatus(refreshStoreAccess, REPO_ID, workspaceRuntimeId)

    expect(getRepoWorktreeStatusQueryData(REPO_ID, workspaceRuntimeId)?.loadedAt).toBe(loadedAt)
    expect(primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, workspaceRuntimeId))?.error).toEqual(
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

  test('cancels projection data-load state when a read is cancelled without a successor', async () => {
    const workspaceRuntimeId = seedRepo([branch('feature/a')])
    ipcHandlers['repo.projection'] = async () => {
      throw new CancelledError()
    }

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.dataLoads.repoReadModel).toMatchObject({
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
    const workspaceRuntimeId = seedRepo([branch('main', undefined, { worktree: { path: '/repo' } }), branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        repo.ui,
        { kind: 'git-branch', repoRoot: REPO_ID, branchName: 'feature/a' },
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
            workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: projection.branches }, 'feature/a'),
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
        { kind: 'git-worktree', repoRoot: REPO_ID, worktreePath: '/tmp/worktree-a' },
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
            workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: projection.branches }, 'feature/new'),
          )
        : null,
    ).toBe('terminal')
  })

  test('repo read-model projection refresh prunes terminal sessions to current worktree paths', async () => {
    const workspaceRuntimeId = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
    const calls: Array<{ repoRoot: string }> = []
    ipcHandlers['terminal.prune'] = async (input: { repoRoot: string }) => {
      calls.push(input)
      return { pruned: 1, remaining: 1 }
    }
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [
          branch('main', undefined, { worktree: { path: '/repo' } }),
          branch('feature/a', undefined, { worktree: { path: '/tmp/worktree-a' } }),
          branch('feature/plain'),
        ],
        current: 'main',
      })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })

    expect(calls).toEqual([
      expect.objectContaining({
        repoRoot: REPO_ID,
      }),
    ])
    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    const worktreesByPath = readRepoBranchQueryProjection(repo)?.worktreesByPath
    expect(worktreesByPath?.['/tmp/stale-worktree']).toBeUndefined()
    expect(Object.keys(worktreesByPath ?? {}).sort()).toEqual(['/repo', '/tmp/worktree-a'])
  })

  test('repo read-model projection refresh warns when pruning terminal sessions fails', async () => {
    const workspaceRuntimeId = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
    const err = new Error('prune failed')
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    ipcHandlers['terminal.prune'] = async () => {
      throw err
    }
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [branch('main', undefined, { worktree: { path: '/repo' } })],
        current: 'main',
      })

    await requestRepoProjectionReadModelRefresh(refreshStoreAccess, REPO_ID, { workspaceRuntimeId })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warnSpy).toHaveBeenCalledWith('failed to prune repo sessions', { err })
  })
})
