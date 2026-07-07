import { beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { terminalLog } from '#/web/logger.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { repoOperation } from '#/web/stores/repos/repo-operation-scheduler.ts'
import {
  branch,
  REPO_ID,
  resetRefreshTest,
  ipcHandlers,
  seedRepo,
  repoProjection,
} from '#/web/stores/repos/refresh-test-utils.ts'
import { seedRepoReadModelQueryData, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoDataQueryKey, repoProjectionQueryKey } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/web/types.ts'
beforeEach(resetRefreshTest)

type TestRepo = NonNullable<ReturnType<typeof useReposStore.getState>['repos'][string]>
type TestCreateWorktreeAction = Parameters<ReturnType<typeof useReposStore.getState>['runBranchAction']>[1]

function updateRepoForTest(mutator: (repo: TestRepo) => void) {
  useReposStore.setState((s) => {
    const repo = s.repos[REPO_ID]
    if (!repo) return s
    return { repos: { ...s.repos, [REPO_ID]: replaceRepo(repo, mutator) } }
  })
}

function repoBranchNames(): string[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.branches.map((branch) => branch.name) ?? []) : []
}

function repoCurrentBranch(): string | null {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? (readRepoBranchQueryProjection(repo)?.currentBranch ?? null) : null
}

function cachedRepoProjection(repoInstanceId: string): RepoRuntimeProjection | undefined {
  return primaryWindowQueryClient.getQueryData<RepoRuntimeProjection>(
    repoProjectionQueryKey(REPO_ID, repoInstanceId, null, 'full'),
  )
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
  test('repo read-model projection refresh treats query projection branches as existing data while loading', async () => {
    const repoInstanceId = seedRepo([])
    seedRepoReadModelQueryData({ id: REPO_ID, instanceId: repoInstanceId }, {
      branches: [branch('feature/query')],
      currentBranch: 'feature/query',
    })
    let resolveSnapshot!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    ipcHandlers['repo.projection'] = () =>
      new Promise((resolve) => {
        resolveSnapshot = (snapshot) => resolve(repoProjection(snapshot))
      })

    const work = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })
    await Promise.resolve()

    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.repoReadModel.phase).toBe('refreshing')

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
    // projection folds snapshot + status into one round trip, but for
    // assertions each side still counts as 1 (semantic: it was
    // refreshed). Standalone handlers are kept for tests that exercise
    // the post-write single-data-load path.
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      statusCount += 1
      return {
        snapshot: { branches: [branch('feature/a')], current: 'feature/a' },
        status: [],
        pullRequests: null,
      }
    }

    await useReposStore.getState().syncAndRefresh(REPO_ID, {
      repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
    })

    expect(fetchCount).toBe(0)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
  })

  test('manual sync records the remote fetch settled time', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().syncAndRefresh(REPO_ID, { repoInstanceId })

    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.fetch.loadedAt).toBeGreaterThanOrEqual(before)
  })

  test('manual sync ignores stale fetch results after repo reopen', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const repoInstanceId = seedRepo([branch('main')], 'repo-instance-test')
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [branch('feature/reopened')],
        current: 'feature/reopened',
      })

    const work = useReposStore.getState().syncAndRefresh(REPO_ID, { repoInstanceId })
    seedRepo([branch('main')], 'repo-instance-test-2')
    resolveFetch({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceId).toBe('repo-instance-test-2')
    expect(repo?.events).toEqual([])
    expect(repo?.dataLoads.fetch.loadedAt).toBeNull()
  })

  test('network operations expose repo-level fetch busy state', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let resolveNetwork!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveNetwork = resolve
      })

    const work = useReposStore.getState().syncAndRefresh(REPO_ID, { repoInstanceId })

    const runningRepo = useReposStore.getState().repos[REPO_ID]
    expect(runningRepo?.dataLoads.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveNetwork({ ok: true, message: 'ok' })
    await work

    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.fetch.phase).toBe('idle')
  })

  test('manual sync records failed fetch results and still refreshes local state', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.fetch'] = async () => ({ ok: false, message: 'fatal: rejected' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    await useReposStore.getState().syncAndRefresh(REPO_ID, { repoInstanceId })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'fatal: rejected' } })
    expect(snapshotCount).toBe(1)
  })

  test('manual sync refreshes fetch, snapshot, and status without implicit pull request summary backfill', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
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

    await useReposStore.getState().syncAndRefresh(REPO_ID, { repoInstanceId })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchCount).toBe(1)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
  })

  test('manual sync records thrown fetch failures instead of rejecting', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    ipcHandlers['repo.fetch'] = async () => {
      throw new Error('network down')
    }

    await expect(useReposStore.getState().syncAndRefresh(REPO_ID, { repoInstanceId })).resolves.toBeUndefined()

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'network down' } })
    expect(repo?.dataLoads.fetch.phase).toBe('idle')
  })

  test('branch network actions expose branch and fetch operation state', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let resolvePull!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.pull'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolvePull = resolve
      })

    const work = useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { repoInstanceId })

    const runningRepo = useReposStore.getState().repos[REPO_ID]
    expect(runningRepo?.operations.branchAction.phase).toBe('running')
    expect(runningRepo?.dataLoads.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolvePull({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repo?.dataLoads.fetch.phase).toBe('idle')
  })

  test('branch write actions run through branch operation state and refresh after completion', async () => {
    const repoInstanceId = seedRepo([branch('main'), branch('feature/a')])
    let resolveDelete!: (value: { ok: true; message: string }) => void
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveDelete = resolve
      })
    // Post-write branch action refresh goes through projection in
    // `runCoreDataRefreshWorkflow` now.
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main')], current: 'main' })
    }

    const work = useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'deleteBranch', branch: 'feature/a' }, { repoInstanceId })

    const runningRepo = useReposStore.getState().repos[REPO_ID]
    expect(runningRepo?.operations.branchAction.phase).toBe('running')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveDelete({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repoBranchNames()).toEqual(['main'])
    expect(snapshotCount).toBe(1)
  })

  test('create worktree runs through branch operation state and refreshes only after success', async () => {
    const repoInstanceId = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({ ok: true, message: 'ok' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main'), branch('feature/a')], current: 'main' })
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId, refreshOnError: false })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repoBranchNames()).toEqual(['main', 'feature/a'])
    expect(snapshotCount).toBe(1)
  })

  test('create worktree failure does not refresh when requested by command caller', async () => {
    const repoInstanceId = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({ ok: false, message: 'error.invalid-path' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main'), branch('feature/a')], current: 'main' })
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId, refreshOnError: false })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(snapshotCount).toBe(0)
  })

  test('create worktree partial failure refreshes when the repository already changed', async () => {
    const repoInstanceId = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({
      ok: false,
      message: 'Worktree bootstrap failed: setup failed',
      repoChanged: true,
    })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('main'), branch('feature/a')], current: 'main' })
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, createWorktreeAction(), { repoInstanceId, refreshOnError: false })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: setup failed',
      repoChanged: true,
    })
    expect(snapshotCount).toBe(1)
    expect(repoBranchNames()).toEqual(['main', 'feature/a'])
  })

  test('deferred branch action results skip toast and refresh until caller confirms follow-up', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = async () => ({ ok: false, message: 'error.branch-not-fully-merged' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(
        REPO_ID,
        { kind: 'deleteBranch', branch: 'feature/a' },
        { repoInstanceId, deferResultMessages: ['error.branch-not-fully-merged'] },
      )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(result).toEqual({ ok: false, message: 'error.branch-not-fully-merged' })
    expect(repo?.events).toEqual([])
    expect(snapshotCount).toBe(0)
    expect(repo?.operations.branchAction.phase).toBe('idle')
  })

  test('branch action failures refresh by default', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = async () => ({ ok: false, message: 'error.delete-branch-failed' })
    ipcHandlers['repo.projection'] = async () => {
      snapshotCount += 1
      return repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'deleteBranch', branch: 'feature/a' }, { repoInstanceId })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(result).toEqual({ ok: false, message: 'error.delete-branch-failed' })
    expect(repo?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.delete-branch-failed' },
    })
    expect(snapshotCount).toBe(1)
  })

  test('failed network branch actions do not clear the sticky fetch failure badge', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.remote.fetchFailed = true
      repo.remote.fetchError = 'previous failure'
    })
    ipcHandlers['repo.pull'] = async () => ({ ok: false, message: 'fatal: rejected' })

    await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { repoInstanceId })

    expect(useReposStore.getState().repos[REPO_ID]?.remote).toMatchObject({
      fetchFailed: true,
      fetchError: 'previous failure',
    })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
      target: null,
    })
    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.fetch).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
    })
  })

  test('remove worktree delegates terminal cleanup to the native host action', async () => {
    const repoInstanceId = seedRepo([branch('feature/a', undefined, { worktree: { path: '/tmp/worktree-a' } })])
    const calls: string[] = []
    ipcHandlers['repo.removeWorktree'] = async () => {
      calls.push('removeWorktree')
      return { ok: true, message: 'ok' }
    }

    await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'removeWorktree',
        branch: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        alsoDeleteBranch: false,
        forceDeleteBranch: false,
      },
      { repoInstanceId },
    )

    expect(calls).toEqual(['removeWorktree'])
  })
})

describe('core refresh request ordering', () => {
  test('refreshCoreData refreshes snapshot and status via the projection endpoint', async () => {
    const repoInstanceId = seedRepo([branch('old')])
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

    await useReposStore.getState().refreshCoreData(REPO_ID, { repoInstanceId })

    expect(projectionCalls).toBe(1)
    expect(repoBranchNames()).toEqual(['main'])
  })

  test('refreshCoreData writes the server projection result into repo data query cache', async () => {
    const repoInstanceId = seedRepo([branch('old')])
    const status: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'main', isMain: true, entries: [{ x: 'M', y: ' ', path: 'src/main.ts' }] },
    ]
    const snapshot = { branches: [branch('main')], current: 'main' }
    const projection = {
      snapshot,
      status,
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: null, pullRequestMode: 'full' as const },
      loadedAt: 123,
    }
    ipcHandlers['repo.projection'] = async () => projection

    await useReposStore.getState().refreshCoreData(REPO_ID, { repoInstanceId })

    expect(primaryWindowQueryClient.getQueryData(repoProjectionQueryKey(REPO_ID, repoInstanceId, null, 'full'))).toEqual(
      projection,
    )
  })

  test('refreshCoreData drops stale results when the repo is reopened during a projection read', async () => {
    const repoInstanceId = seedRepo([branch('main')], 'repo-instance-test')
    primaryWindowQueryClient.removeQueries({ queryKey: repoDataQueryKey(REPO_ID, repoInstanceId) })
    ipcHandlers['repo.projection'] = async () => {
      // Reopen the repo while the projection is in flight. With the new
      // atomic flow the snapshot result is stale and should be dropped
      // (the new instance keeps its own data).
      seedRepo([branch('reopened')], 'repo-instance-test-2')
      return {
        snapshot: { branches: [branch('stale')], current: 'stale' },
        status: [],
        pullRequests: null,
        operations: { operations: [], loadedAt: 123 },
        requested: { branch: null, pullRequestMode: 'full' },
        loadedAt: 123,
      }
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { repoInstanceId })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceId).toBe('repo-instance-test-2')
    expect(repo ? readRepoBranchQueryProjection(repo)?.branches.map((b) => b.name) : null).toEqual(['reopened'])
    expect(
      primaryWindowQueryClient.getQueryData(repoProjectionQueryKey(REPO_ID, repoInstanceId, null, 'full')),
    ).toBeUndefined()
  })

  test('refreshCoreData marks deleted or non-git paths unavailable and skips follow-up reads', async () => {
    const repoInstanceId = seedRepo([branch('main')])
    let projectionCalls = 0
    ipcHandlers['repo.projection'] = async () => {
      projectionCalls += 1
      throw new Error('error.not-git-repo')
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { repoInstanceId })

    expect(projectionCalls).toBe(1)
    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.availability).toMatchObject({ phase: 'unavailable', reason: 'error.not-git-repo' })
    expect(repo?.dataLoads.repoReadModel.error).toBe('error.not-git-repo')
  })

  test('repo read-model projection refresh restores an unavailable repo when the path is a git repo again', async () => {
    const repoInstanceId = seedRepo([branch('old')])
    updateRepoForTest((repo) => {
      repo.availability = { phase: 'unavailable', reason: 'error.path-not-found', checkedAt: Date.now() }
    })
    ipcHandlers['repo.projection'] = async () => repoProjection({ branches: [branch('main')], current: 'main' })

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.availability).toEqual({ phase: 'available' })
    expect(repoBranchNames()).toEqual(['main'])
    expect(repo?.dataLoads.repoReadModel.error).toBeNull()
  })

  test('repo read-model projection refresh writes the server snapshot result into repo data query cache', async () => {
    const repoInstanceId = seedRepo([branch('old')])
    const snapshot = { branches: [branch('main')], current: 'main' }
    ipcHandlers['repo.projection'] = async () => repoProjection(snapshot)

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    expect(cachedRepoProjection(repoInstanceId)?.snapshot).toEqual(snapshot)
  })

  test('refreshCoreData drops status when the repo is reopened before the projection settles', async () => {
    const repoInstanceId = seedRepo([branch('main')], 'repo-instance-test')
    ipcHandlers['repo.projection'] = async () => {
      // projection returns valid snapshot, but the repo is reopened
      // before the apply step. Both branches get dropped.
      seedRepo([branch('reopened')], 'repo-instance-test-2')
      return { snapshot: { branches: [branch('main')], current: 'main' }, status: [], pullRequests: null }
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { repoInstanceId })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceId).toBe('repo-instance-test-2')
    expect(repo ? readRepoBranchQueryProjection(repo)?.branches.map((b) => b.name) : null).toEqual(['reopened'])
  })

  test('ignores stale status refreshes for the same repo instance', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: WorktreeStatus[]) => void
    let resolveSecond!: (value: WorktreeStatus[]) => void
    ipcHandlers['repo.projection'] = () => {
      callCount += 1
      return new Promise((resolve) => {
        const complete = (status: WorktreeStatus[]) =>
          resolve(repoProjection({ branches: [branch('feature/a')], current: 'feature/a' }, status))
        if (callCount === 1) resolveFirst = complete
        else resolveSecond = complete
      })
    }

    const first = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' })
    const second = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' })
    const fresh = [{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] }]

    resolveSecond(fresh)
    await second
    expect(cachedRepoProjection(repoInstanceId)?.status).toEqual(fresh)

    resolveFirst([{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'stale.ts' }] }])
    await first
    expect(cachedRepoProjection(repoInstanceId)?.status).toEqual(fresh)
  })

  test('status projection refresh updates normalized worktree dirty metadata in the branch read model', async () => {
    const repoInstanceId = seedRepo([
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
      repoProjection(
        {
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
        },
        [
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
      )

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' })

    const repo = useReposStore.getState().repos[REPO_ID]!
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
      isDirty: true,
      changeCount: 3,
    })
  })

  test('status projection refresh writes the server status result into repo data query cache', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    const status: WorktreeStatus[] = [
      { path: REPO_ID, branch: 'feature/a', isMain: true, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
    ]
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({ branches: [branch('feature/a')], current: 'feature/a' }, status)

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' })

    expect(cachedRepoProjection(repoInstanceId)?.status).toEqual(status)
  })

  test('repo read-model projection refresh keeps status-derived worktree dirtiness authoritative', async () => {
    const repoInstanceId = seedRepo(
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
      'repo-instance-test',
    )
    seedRepoReadModelQueryData(
      { id: REPO_ID, instanceId: repoInstanceId },
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
      repoProjection(
        {
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
        },
        [{ path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [] }],
      )

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    const repo = useReposStore.getState().repos[REPO_ID]!
    expect(readRepoBranchQueryProjection(repo)?.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
  })

  test('repo read-model projection refresh stores worktree state in the branch read model', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
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

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    const repo = useReposStore.getState().repos[REPO_ID]
    const projection = repo ? readRepoBranchQueryProjection(repo) : null
    expect(projection?.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(projection?.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: true,
      changeCount: 3,
    })
  })

  test('status projection refresh records data-load loading, success, and stale error state', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let resolveStatus!: (value: WorktreeStatus[]) => void
    const status: WorktreeStatus[] = [{ path: '/tmp/gbl-test-repo', branch: 'feature/a', isMain: true, entries: [] }]
    ipcHandlers['repo.projection'] = () =>
      new Promise((resolve) => {
        resolveStatus = (status) =>
          resolve(repoProjection({ branches: [branch('feature/a')], current: 'feature/a' }, status))
      })

    const work = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' })

    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.visibleStatus).toMatchObject({
      phase: 'loading',
      loadedAt: null,
      error: null,
      stale: false,
    })

    resolveStatus(status)
    await work

    const loadedAt = useReposStore.getState().repos[REPO_ID]?.dataLoads.visibleStatus.loadedAt
    expect(loadedAt).toEqual(expect.any(Number))
    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.visibleStatus).toMatchObject({
      phase: 'idle',
      error: null,
      stale: false,
    })

    ipcHandlers['repo.projection'] = async () => {
      throw new Error('status failed')
    }

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' })

    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.visibleStatus).toMatchObject({
      phase: 'idle',
      loadedAt,
      error: 'status failed',
      stale: true,
    })
  })

  test('marks read operations as queued before scheduler starts them', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    const resolvers: Array<(value: WorktreeStatus[]) => void> = []
    ipcHandlers['repo.projection'] = () =>
      new Promise((resolve) => {
        resolvers.push((status) =>
          resolve(repoProjection({ branches: [branch('feature/a')], current: 'feature/a' }, status)),
        )
      })

    const works = Array.from({ length: 4 }, () => useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' }))

    expect(resolvers).toHaveLength(3)
    expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('queued')

    resolvers[0]?.([])
    await works[0]

    expect(resolvers).toHaveLength(4)
    expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('running')

    resolvers[1]?.([])
    resolvers[2]?.([])
    resolvers[3]?.([])
    await Promise.all(works)

    expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('idle')
  })

  test('closing a repo cancels active and queued repo operations', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let callCount = 0
    ipcHandlers['repo.abort'] = async () => ({ ok: true, message: 'ok' })
    ipcHandlers['repo.projection'] = () => {
      callCount += 1
      return new Promise(() => {})
    }

    const works = Array.from({ length: 4 }, () => useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' }))
    expect(callCount).toBe(3)
    expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('queued')

    useReposStore.getState().closeRepo(REPO_ID)

    await expect(Promise.all(works)).resolves.toEqual([undefined, undefined, undefined, undefined])
    expect(useReposStore.getState().repos[REPO_ID]).toBeUndefined()
  })

  test('drops older queued status refreshes before they start', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    const resolvers: Array<(value: WorktreeStatus[]) => void> = []
    ipcHandlers['repo.projection'] = () =>
      new Promise((resolve) => {
        resolvers.push((status) =>
          resolve(repoProjection({ branches: [branch('feature/a')], current: 'feature/a' }, status)),
        )
      })

    const works = Array.from({ length: 5 }, () => useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'visible-status' }))
    const fresh = [{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] }]

    try {
      expect(resolvers).toHaveLength(3)
      expect(repoOperation(REPO_ID, 'visibleStatus').phase).toBe('queued')

      await expect(works[3]).resolves.toBeUndefined()

      resolvers[0]?.([])
      await works[0]

      expect(resolvers).toHaveLength(4)
      resolvers[3]?.(fresh)
      await works[4]

      expect(cachedRepoProjection(repoInstanceId)?.status).toEqual(fresh)
    } finally {
      resolvers[1]?.([])
      resolvers[2]?.([])
      await Promise.allSettled([works[1], works[2]])
      await Promise.allSettled(works)
    }
  })

  test('ignores stale repo read-model projection refreshes for the same repo instance', async () => {
    const repoInstanceId = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    let resolveSecond!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    ipcHandlers['repo.projection'] = () => {
      callCount += 1
      return new Promise((resolve) => {
        const complete = (snapshot: { branches: ReturnType<typeof branch>[]; current: string }) =>
          resolve(repoProjection(snapshot))
        if (callCount === 1) resolveFirst = complete
        else resolveSecond = complete
      })
    }

    const first = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })
    const second = useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    resolveSecond({ branches: [branch('fresh')], current: 'fresh' })
    await second
    expect(repoCurrentBranch()).toBe('fresh')

    resolveFirst({ branches: [branch('stale')], current: 'stale' })
    await first
    expect(repoCurrentBranch()).toBe('fresh')
  })

  test('repo read-model projection refresh preserves the terminal preference when the selected branch has no worktree', async () => {
    // The store never re-projects the preferred tab. Whether the terminal
    // tab is renderable is decided at read time by the workspace pane tab
    // model, which inspects the active branch's worktree + terminal session count.
    const repoInstanceId = seedRepo([branch('main', undefined, { worktree: { path: '/repo' } }), branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        repo.ui,
        { repoRoot: REPO_ID, branchName: 'feature/a', worktreePath: null },
        'terminal',
      )
    })
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({ branches: [branch('feature/a')], current: 'feature/a' })

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    const repo = useReposStore.getState().repos[REPO_ID]
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
    const repoInstanceId = seedRepo([
      branch('feature/old', undefined, { worktree: { path: '/tmp/worktree-a' } }),
      branch('feature/new'),
    ])
    updateRepoForTest((repo) => {
      repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        repo.ui,
        { repoRoot: REPO_ID, branchName: 'feature/old', worktreePath: '/tmp/worktree-a' },
        'terminal',
      )
    })
    ipcHandlers['repo.projection'] = async () =>
      repoProjection({
        branches: [branch('feature/old'), branch('feature/new', undefined, { worktree: { path: '/tmp/worktree-a' } })],
        current: 'feature/new',
      })

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    const repo = useReposStore.getState().repos[REPO_ID]
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
    const repoInstanceId = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
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

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })

    expect(calls).toEqual([
      expect.objectContaining({
        repoRoot: REPO_ID,
      }),
    ])
    const repo = useReposStore.getState().repos[REPO_ID]!
    const worktreesByPath = readRepoBranchQueryProjection(repo)?.worktreesByPath
    expect(worktreesByPath?.['/tmp/stale-worktree']).toBeUndefined()
    expect(Object.keys(worktreesByPath ?? {}).sort()).toEqual(['/repo', '/tmp/worktree-a'])
  })

  test('repo read-model projection refresh warns when pruning terminal sessions fails', async () => {
    const repoInstanceId = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
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

    await useReposStore.getState().refreshRuntimeProjection(REPO_ID, { repoInstanceId, scope: 'repo-read-model' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warnSpy).toHaveBeenCalledWith('failed to prune repo sessions', { err })
  })
})
