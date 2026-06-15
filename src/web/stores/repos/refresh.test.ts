import { beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceRepo } from '#/web/stores/repos/helpers.ts'
import { terminalLog } from '#/web/logger.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { markRepoOperationTargets, repoOperation } from '#/web/stores/repos/runtime.ts'
import { branch, REPO_ID, resetRefreshTest, ipcHandlers, seedRepo } from '#/web/stores/repos/refresh-test-utils.ts'
import { seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { canStartRemoteFetch } from '#/web/stores/repos/sync-state.ts'
import type { LogEntry, WorktreeStatus } from '#/web/types.ts'
beforeEach(resetRefreshTest)

type TestRepo = NonNullable<ReturnType<typeof useReposStore.getState>['repos'][string]>

function updateRepoForTest(mutator: (repo: TestRepo) => void) {
  useReposStore.setState((s) => {
    const repo = s.repos[REPO_ID]
    if (!repo) return s
    return { repos: { ...s.repos, [REPO_ID]: replaceRepo(repo, mutator) } }
  })
}

function logEntry(index: number): LogEntry {
  const hash = `hash-${index}`
  return {
    hash,
    shortHash: hash,
    message: `commit ${index}`,
    author: 'Alice',
    date: '2026-01-01T00:00:00+08:00',
  }
}

describe('remote fetch timestamps', () => {
  test('manual refresh skips repo.fetch for local-only repositories and refreshes local state', async () => {
    seedRepoState({
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
    // Composite folds snapshot + status into one round trip, but for
    // assertions each side still counts as 1 (semantic: it was
    // refreshed). Standalone handlers are kept for tests that exercise
    // the post-write single-resource path.
    ipcHandlers['repo.composite'] = async () => {
      snapshotCount += 1
      statusCount += 1
      return {
        snapshot: { branches: [branch('feature/a')], current: 'feature/a' },
        status: [],
        pullRequests: null,
      }
    }

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token: 1 })

    expect(fetchCount).toBe(0)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
  })

  test('manual sync records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch.loadedAt).toBeGreaterThanOrEqual(before)
  })

  test('manual sync ignores stale fetch results after repo reopen', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const token = seedRepo([branch('feature/a')], 1)
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/reopened')],
      current: 'feature/reopened',
    })

    const work = useReposStore.getState().syncAndRefresh(REPO_ID, { token })
    seedRepo([branch('feature/a')], 2)
    resolveFetch({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.events).toEqual([])
    expect(repo?.resources.fetch.loadedAt).toBeNull()
  })

  test('network operations expose repo-level fetch busy state', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveNetwork!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveNetwork = resolve
      })

    const work = useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    const runningRepo = useReposStore.getState().repos[REPO_ID]
    expect(runningRepo?.resources.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveNetwork({ ok: true, message: 'ok' })
    await work

    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch.phase).toBe('idle')
  })

  test('manual sync records failed fetch results and still refreshes local state', async () => {
    const token = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.fetch'] = async () => ({ ok: false, message: 'fatal: rejected' })
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
    }
    ipcHandlers['repo.composite'] = async () => {
      snapshotCount += 1
      return { snapshot: { branches: [branch('feature/a')], current: 'feature/a' }, status: [], pullRequests: null }
    }

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'fatal: rejected' } })
    expect(snapshotCount).toBe(1)
  })

  test('manual sync refreshes fetch, snapshot, status, and pull request data for the active repo', async () => {
    const token = seedRepo([branch('feature/a')])
    let fetchCount = 0
    let snapshotCount = 0
    let statusCount = 0
    const pullRequestCalls: Array<{ branches?: string[]; mode?: string }> = []
    ipcHandlers['repo.fetch'] = async () => {
      fetchCount += 1
      return { ok: true, message: 'ok' }
    }
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a'), branch('feature/b')], current: 'feature/a' }
    }
    ipcHandlers['repo.status'] = async () => {
      statusCount += 1
      return []
    }
    ipcHandlers['repo.composite'] = async () => {
      snapshotCount += 1
      statusCount += 1
      return {
        snapshot: { branches: [branch('feature/a'), branch('feature/b')], current: 'feature/a' },
        status: [],
        pullRequests: null,
      }
    }
    ipcHandlers['repo.pullRequests'] = async ({ branches, mode }: { branches?: string[]; mode?: string }) => {
      pullRequestCalls.push({ branches, mode: mode })
      return []
    }

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchCount).toBe(1)
    expect(snapshotCount).toBe(1)
    expect(statusCount).toBe(1)
    expect(pullRequestCalls).toEqual([
      { branches: ['feature/a', 'feature/b'], mode: 'summary' },
      { branches: ['feature/a'], mode: 'full' },
    ])
  })

  test('manual sync records thrown fetch failures instead of rejecting', async () => {
    const token = seedRepo([branch('feature/a')])
    ipcHandlers['repo.fetch'] = async () => {
      throw new Error('network down')
    }

    await expect(useReposStore.getState().syncAndRefresh(REPO_ID, { token })).resolves.toBeUndefined()

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'network down' } })
    expect(repo?.resources.fetch.phase).toBe('idle')
  })

  test('branch network actions expose branch and fetch operation state', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolvePull!: (value: { ok: true; message: string }) => void
    ipcHandlers['repo.pull'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolvePull = resolve
      })

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { token })

    const runningRepo = useReposStore.getState().repos[REPO_ID]
    expect(runningRepo?.operations.branchAction.phase).toBe('running')
    expect(runningRepo?.resources.fetch.phase).toBe('loading')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolvePull({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repo?.resources.fetch.phase).toBe('idle')
  })

  test('branch write actions run through branch operation state and refresh after completion', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveCheckout!: (value: { ok: true; message: string }) => void
    let snapshotCount = 0
    ipcHandlers['repo.checkout'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveCheckout = resolve
      })
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
    }
    // Post-write branch action refresh goes through composite in
    // `runCoreDataRefreshWorkflow` now.
    ipcHandlers['repo.composite'] = async () => {
      snapshotCount += 1
      return { snapshot: { branches: [branch('feature/a')], current: 'feature/a' }, status: [], pullRequests: null }
    }

    const work = useReposStore.getState().runBranchAction(REPO_ID, { kind: 'checkout', branch: 'feature/a' }, { token })

    const runningRepo = useReposStore.getState().repos[REPO_ID]
    expect(runningRepo?.operations.branchAction.phase).toBe('running')
    expect(canStartRemoteFetch(runningRepo)).toBe(false)

    resolveCheckout({ ok: true, message: 'ok' })
    await work

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repo?.data.currentBranch).toBe('feature/a')
    expect(snapshotCount).toBe(1)
  })

  test('create worktree runs through branch operation state and refreshes only after success', async () => {
    const token = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({ ok: true, message: 'ok' })
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('main'), branch('feature/a')], current: 'main' }
    }
    ipcHandlers['repo.composite'] = async () => {
      snapshotCount += 1
      return {
        snapshot: { branches: [branch('main'), branch('feature/a')], current: 'main' },
        status: [],
        pullRequests: null,
      }
    }

    const result = await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        input: {
          worktreePath: '/tmp/worktrees/feature-a',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        },
      },
      { token, refreshOnError: false },
    )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(repo?.operations.branchAction.phase).toBe('idle')
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['main', 'feature/a'])
    expect(snapshotCount).toBe(1)
  })

  test('create worktree failure does not refresh when requested by command caller', async () => {
    const token = seedRepo([branch('main')])
    let snapshotCount = 0
    ipcHandlers['repo.createWorktree'] = async () => ({ ok: false, message: 'error.invalid-path' })
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('main'), branch('feature/a')], current: 'main' }
    }

    const result = await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        input: {
          worktreePath: '/tmp/worktrees/feature-a',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        },
      },
      { token, refreshOnError: false },
    )

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(snapshotCount).toBe(0)
  })

  test('deferred branch action results skip toast and refresh until caller confirms follow-up', async () => {
    const token = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.deleteBranch'] = async () => ({ ok: false, message: 'error.branch-not-fully-merged' })
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(
        REPO_ID,
        { kind: 'deleteBranch', branch: 'feature/a' },
        { token, deferResultMessages: ['error.branch-not-fully-merged'] },
      )

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(result).toEqual({ ok: false, message: 'error.branch-not-fully-merged' })
    expect(repo?.events).toEqual([])
    expect(snapshotCount).toBe(0)
    expect(repo?.operations.branchAction.phase).toBe('idle')
  })

  test('branch action failures refresh by default', async () => {
    const token = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    ipcHandlers['repo.checkout'] = async () => ({ ok: false, message: 'error.checkout-failed' })
    ipcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
    }
    ipcHandlers['repo.composite'] = async () => {
      snapshotCount += 1
      return { snapshot: { branches: [branch('feature/a')], current: 'feature/a' }, status: [], pullRequests: null }
    }

    const result = await useReposStore
      .getState()
      .runBranchAction(REPO_ID, { kind: 'checkout', branch: 'feature/a' }, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(result).toEqual({ ok: false, message: 'error.checkout-failed' })
    expect(repo?.events.at(-1)).toMatchObject({
      kind: 'result',
      result: { ok: false, message: 'error.checkout-failed' },
    })
    expect(snapshotCount).toBe(1)
  })

  test('failed network branch actions do not clear the sticky fetch failure badge', async () => {
    const token = seedRepo([branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.remote.fetchFailed = true
      repo.remote.fetchError = 'previous failure'
    })
    ipcHandlers['repo.pull'] = async () => ({ ok: false, message: 'fatal: rejected' })

    await useReposStore.getState().runBranchAction(REPO_ID, { kind: 'pull', branch: 'feature/a' }, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.remote).toMatchObject({
      fetchFailed: true,
      fetchError: 'previous failure',
    })
    expect(useReposStore.getState().repos[REPO_ID]?.operations.branchAction).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
      target: null,
    })
    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch).toMatchObject({
      phase: 'idle',
      error: 'fatal: rejected',
    })
  })

  test('remove worktree delegates terminal cleanup to the main process action', async () => {
    const token = seedRepo([branch('feature/a', undefined, { worktree: { path: '/tmp/worktree-a' } })])
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
      { token },
    )

    expect(calls).toEqual(['removeWorktree'])
  })
})

describe('core refresh request ordering', () => {
  test('refreshCoreData refreshes snapshot and status via the composite endpoint', async () => {
    const token = seedRepo([branch('old')])
    let compositeCalls = 0
    ipcHandlers['repo.composite'] = async () => {
      compositeCalls += 1
      return { snapshot: { branches: [branch('main')], current: 'main' }, status: [], pullRequests: null }
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { token })

    expect(compositeCalls).toBe(1)
    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['main'])
  })

  test('refreshCoreData drops stale results when the repo is reopened during a composite read', async () => {
    const token = seedRepo([branch('old')], 1)
    ipcHandlers['repo.composite'] = async () => {
      // Reopen the repo while the composite is in flight. With the new
      // atomic flow the snapshot result is stale and should be dropped
      // (the new instance keeps its own data).
      seedRepo([branch('reopened')], 2)
      return { snapshot: { branches: [branch('stale')], current: 'stale' }, status: [], pullRequests: null }
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['reopened'])
  })

  test('refreshCoreData marks deleted or non-git paths unavailable and skips follow-up reads', async () => {
    const token = seedRepo([branch('main')])
    let compositeCalls = 0
    ipcHandlers['repo.composite'] = async () => {
      compositeCalls += 1
      throw new Error('error.not-git-repo')
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { token })

    expect(compositeCalls).toBe(1)
    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.availability).toMatchObject({ phase: 'unavailable', reason: 'error.not-git-repo' })
    expect(repo?.resources.snapshot.error).toBe('error.not-git-repo')
  })

  test('refreshSnapshot restores an unavailable repo when the path is a git repo again', async () => {
    const token = seedRepo([branch('old')])
    updateRepoForTest((repo) => {
      repo.availability = { phase: 'unavailable', reason: 'error.path-not-found', checkedAt: Date.now() }
    })
    ipcHandlers['repo.snapshot'] = async () => ({ branches: [branch('main')], current: 'main' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.availability).toEqual({ phase: 'available' })
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['main'])
    expect(repo?.resources.snapshot.error).toBeNull()
  })

  test('refreshCoreData drops status when the repo is reopened before the composite settles', async () => {
    const token = seedRepo([branch('main')], 1)
    ipcHandlers['repo.composite'] = async () => {
      // Composite returns valid snapshot, but the repo is reopened
      // before the apply step. Both branches get dropped.
      seedRepo([branch('reopened')], 2)
      return { snapshot: { branches: [branch('main')], current: 'main' }, status: [], pullRequests: null }
    }

    await useReposStore.getState().refreshCoreData(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['reopened'])
  })

  test('ignores stale status refreshes for the same repo instance', async () => {
    const token = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: WorktreeStatus[]) => void
    let resolveSecond!: (value: WorktreeStatus[]) => void
    ipcHandlers['repo.status'] = () => {
      callCount += 1
      return new Promise<WorktreeStatus[]>((resolve) => {
        if (callCount === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    }

    const first = useReposStore.getState().refreshStatus(REPO_ID, { token })
    const second = useReposStore.getState().refreshStatus(REPO_ID, { token })
    const fresh = [{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] }]

    resolveSecond(fresh)
    await second
    expect(useReposStore.getState().repos[REPO_ID]?.data.status).toEqual(fresh)

    resolveFirst([{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'stale.ts' }] }])
    await first
    expect(useReposStore.getState().repos[REPO_ID]?.data.status).toEqual(fresh)
  })

  test('refreshStatus updates normalized worktree dirty metadata', async () => {
    const token = seedRepo([
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
    ipcHandlers['repo.status'] = async () => [
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
    ]

    await useReposStore.getState().refreshStatus(REPO_ID, { token })

    const worktreesByPath = useReposStore.getState().repos[REPO_ID]?.data.worktreesByPath
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

  test('snapshot refresh keeps status-derived worktree dirtiness authoritative', async () => {
    const token = seedRepo(
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
      1,
    )
    updateRepoForTest((repo) => {
      repo.data.status = [{ path: '/tmp/worktree-a', branch: 'feature/a', isMain: false, entries: [] }]
      repo.data.statusLoaded = true
    })
    ipcHandlers['repo.snapshot'] = async () => ({
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

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: false,
      changeCount: 0,
    })
  })

  test('snapshot refresh stores worktree state outside branch state', async () => {
    const token = seedRepo([branch('feature/a')])
    ipcHandlers['repo.snapshot'] = async () => ({
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

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.data.branches[0]?.worktree).not.toHaveProperty('summary')
    expect(repo?.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: true,
      changeCount: 3,
    })
  })

  test('refreshStatus records resource loading, success, and stale error state', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveStatus!: (value: WorktreeStatus[]) => void
    const status: WorktreeStatus[] = [{ path: '/tmp/gbl-test-repo', branch: 'feature/a', isMain: true, entries: [] }]
    ipcHandlers['repo.status'] = () =>
      new Promise<WorktreeStatus[]>((resolve) => {
        resolveStatus = resolve
      })

    const work = useReposStore.getState().refreshStatus(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.resources.status).toMatchObject({
      phase: 'loading',
      loadedAt: null,
      error: null,
      stale: false,
    })

    resolveStatus(status)
    await work

    const loadedAt = useReposStore.getState().repos[REPO_ID]?.resources.status.loadedAt
    expect(loadedAt).toEqual(expect.any(Number))
    expect(useReposStore.getState().repos[REPO_ID]?.resources.status).toMatchObject({
      phase: 'idle',
      error: null,
      stale: false,
    })

    ipcHandlers['repo.status'] = async () => {
      throw new Error('status failed')
    }

    await useReposStore.getState().refreshStatus(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.resources.status).toMatchObject({
      phase: 'idle',
      loadedAt,
      error: 'status failed',
      stale: true,
    })
  })

  test('marks read operations as queued before scheduler starts them', async () => {
    const token = seedRepo([branch('feature/a')])
    const resolvers: Array<(value: WorktreeStatus[]) => void> = []
    ipcHandlers['repo.status'] = () =>
      new Promise<WorktreeStatus[]>((resolve) => {
        resolvers.push(resolve)
      })

    const works = Array.from({ length: 4 }, () => useReposStore.getState().refreshStatus(REPO_ID, { token }))

    expect(resolvers).toHaveLength(3)
    expect(repoOperation(REPO_ID, 'status').phase).toBe('queued')

    resolvers[0]?.([])
    await works[0]

    expect(resolvers).toHaveLength(4)
    expect(repoOperation(REPO_ID, 'status').phase).toBe('running')

    resolvers[1]?.([])
    resolvers[2]?.([])
    resolvers[3]?.([])
    await Promise.all(works)

    expect(repoOperation(REPO_ID, 'status').phase).toBe('idle')
  })

  test('closing a repo cancels active and queued repo operations', async () => {
    const token = seedRepo([branch('feature/a')])
    let callCount = 0
    ipcHandlers['repo.abort'] = async () => ({ ok: true, message: 'ok' })
    ipcHandlers['repo.status'] = () => {
      callCount += 1
      return new Promise<WorktreeStatus[]>(() => {})
    }

    const works = Array.from({ length: 4 }, () => useReposStore.getState().refreshStatus(REPO_ID, { token }))
    expect(callCount).toBe(3)
    expect(repoOperation(REPO_ID, 'status').phase).toBe('queued')

    useReposStore.getState().closeRepo(REPO_ID)

    await expect(Promise.all(works)).resolves.toEqual([undefined, undefined, undefined, undefined])
    expect(useReposStore.getState().repos[REPO_ID]).toBeUndefined()
  })

  test('drops older queued status refreshes before they start', async () => {
    const token = seedRepo([branch('feature/a')])
    const resolvers: Array<(value: WorktreeStatus[]) => void> = []
    ipcHandlers['repo.status'] = () =>
      new Promise<WorktreeStatus[]>((resolve) => {
        resolvers.push(resolve)
      })

    const works = Array.from({ length: 5 }, () => useReposStore.getState().refreshStatus(REPO_ID, { token }))
    const fresh = [{ path: '/repo', isMain: true, entries: [{ x: 'M', y: ' ', path: 'fresh.ts' }] }]

    try {
      expect(resolvers).toHaveLength(3)
      expect(repoOperation(REPO_ID, 'status').phase).toBe('queued')

      await expect(works[3]).resolves.toBeUndefined()

      resolvers[0]?.([])
      await works[0]

      expect(resolvers).toHaveLength(4)
      resolvers[3]?.(fresh)
      await works[4]

      expect(useReposStore.getState().repos[REPO_ID]?.data.status).toEqual(fresh)
    } finally {
      resolvers[1]?.([])
      resolvers[2]?.([])
      await Promise.allSettled([works[1], works[2]])
      await Promise.allSettled(works)
    }
  })

  test('ignores stale snapshot refreshes for the same repo instance', async () => {
    const token = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    let resolveSecond!: (value: { branches: ReturnType<typeof branch>[]; current: string }) => void
    ipcHandlers['repo.snapshot'] = () => {
      callCount += 1
      return new Promise<{ branches: ReturnType<typeof branch>[]; current: string }>((resolve) => {
        if (callCount === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    }

    const first = useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    const second = useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    resolveSecond({ branches: [branch('fresh')], current: 'fresh' })
    await second
    expect(useReposStore.getState().repos[REPO_ID]?.data.currentBranch).toBe('fresh')

    resolveFirst({ branches: [branch('stale')], current: 'stale' })
    await first
    expect(useReposStore.getState().repos[REPO_ID]?.data.currentBranch).toBe('fresh')
  })

  test('snapshot refresh preserves the terminal preference when the selected branch has no worktree', async () => {
    // The store never re-projects the preferred tab. Whether the terminal
    // tab is renderable is decided at read time by `useEffectiveDetailTab`,
    // which inspects the active branch's worktree + terminal session count.
    const token = seedRepo([branch('main', undefined, { worktree: { path: '/repo' } }), branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.ui.selectedBranch = 'feature/a'
      repo.ui.preferredDetailTab = 'terminal'
    })
    ipcHandlers['repo.snapshot'] = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/a')
    expect(repo?.ui.preferredDetailTab).toBe('terminal')
  })

  test('snapshot refresh prunes terminal sessions to current worktree paths', async () => {
    const token = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
    const calls: Array<{ repoRoot: string }> = []
    ipcHandlers['terminal.prune'] = async (input: { repoRoot: string }) => {
      calls.push(input)
      return { pruned: 1, remaining: 1 }
    }
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [
        branch('main', undefined, { worktree: { path: '/repo' } }),
        branch('feature/a', undefined, { worktree: { path: '/tmp/worktree-a' } }),
        branch('feature/plain'),
      ],
      current: 'main',
    })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    expect(calls).toEqual([
      expect.objectContaining({
        repoRoot: REPO_ID,
      }),
    ])
    const worktreesByPath = useReposStore.getState().repos[REPO_ID]?.data.worktreesByPath
    expect(worktreesByPath?.['/tmp/stale-worktree']).toBeUndefined()
    expect(Object.keys(worktreesByPath ?? {}).sort()).toEqual(['/repo', '/tmp/worktree-a'])
  })

  test('snapshot refresh warns when pruning terminal sessions fails', async () => {
    const token = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
    const err = new Error('prune failed')
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    ipcHandlers['terminal.prune'] = async () => {
      throw err
    }
    ipcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('main', undefined, { worktree: { path: '/repo' } })],
      current: 'main',
    })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warnSpy).toHaveBeenCalledWith('failed to prune repo sessions', { err })
  })
})
