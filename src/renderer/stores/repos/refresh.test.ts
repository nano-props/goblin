import { beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceRepo } from '#/renderer/stores/repos/helpers.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { markRepoOperationTargets, repoOperation } from '#/renderer/stores/repos/runtime.ts'
import { INITIAL_LOG_COUNT, LOG_PAGE_SIZE } from '#/renderer/stores/repos/refresh.ts'
import { branch, REPO_ID, resetRefreshTest, rpcHandlers, seedRepo } from '#/renderer/stores/repos/refresh-test-utils.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import type { LogEntry, WorktreeStatus } from '#/renderer/types.ts'
import type { TerminalPruneRepoInput } from '#/shared/terminal.ts'

beforeEach(resetRefreshTest)

type TestRepo = NonNullable<ReturnType<typeof useReposStore.getState>['repos'][string]>

function updateRepoForTest(mutator: (repo: TestRepo) => void) {
  useReposStore.setState((s) => {
    const repo = s.repos[REPO_ID]
    if (!repo) return s
    return { repos: { ...s.repos, [REPO_ID]: replaceRepo(repo, mutator) } }
  })
}

function overrideTerminalBridge(overrides: Partial<Window['goblin']['terminal']>) {
  Object.assign(window.goblin.terminal, overrides)
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
  test('manual sync records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch.loadedAt).toBeGreaterThanOrEqual(before)
  })

  test('manual sync ignores stale fetch results after repo reopen', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    const token = seedRepo([branch('feature/a')], 1)
    rpcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })
    rpcHandlers['repo.snapshot'] = async () => ({
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

  test('background fetch records the remote fetch settled time', async () => {
    const token = seedRepo([branch('feature/a')])
    const before = Date.now()

    await useReposStore.getState().backgroundFetch(REPO_ID)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(token)
    expect(repo?.resources.fetch.loadedAt).toBeGreaterThanOrEqual(before)
  })

  test('background fetch result from a closed repo does not pollute a reopened repo', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    seedRepo([branch('feature/a')], 1)
    rpcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })

    const oldFetch = useReposStore.getState().backgroundFetch(REPO_ID)
    useReposStore.getState().closeRepo(REPO_ID)
    const newToken = seedRepo([branch('feature/reopened')], 2)

    resolveFetch({ ok: true, message: 'ok' })
    await oldFetch

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(newToken)
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['feature/reopened'])
    expect(repo?.remote).toMatchObject({ fetchFailed: false, fetchError: null })
    expect(repo?.resources.fetch.loadedAt).toBeNull()
  })

  test('background fetch records and clears fetch failures', async () => {
    seedRepo([branch('feature/a')])
    let fetchOk = false
    rpcHandlers['repo.fetch'] = async () =>
      fetchOk ? { ok: true, message: 'ok' } : { ok: false, message: 'fatal: offline' }

    await useReposStore.getState().backgroundFetch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]?.remote).toMatchObject({
      fetchFailed: true,
      fetchError: 'fatal: offline',
    })
    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch).toMatchObject({
      phase: 'idle',
      error: 'fatal: offline',
      stale: false,
    })

    fetchOk = true
    await useReposStore.getState().backgroundFetch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]?.remote).toMatchObject({
      fetchFailed: false,
      fetchError: null,
    })
    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch).toMatchObject({
      phase: 'idle',
      error: null,
      stale: false,
    })
  })

  test('background fetch records thrown failures', async () => {
    seedRepo([branch('feature/a')])
    rpcHandlers['repo.fetch'] = async () => {
      throw new Error('network down')
    }

    await useReposStore.getState().backgroundFetch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]?.remote).toMatchObject({
      fetchFailed: true,
      fetchError: 'network down',
    })
  })

  test('does not mark a slow in-flight fetch as already settled', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveFetch!: (value: { ok: true; message: string }) => void
    rpcHandlers['repo.fetch'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })

    const work = useReposStore.getState().backgroundFetch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch.loadedAt).toBeNull()

    resolveFetch({ ok: true, message: 'ok' })
    await work

    expect(useReposStore.getState().repos[REPO_ID]?.instanceToken).toBe(token)
    expect(useReposStore.getState().repos[REPO_ID]?.resources.fetch.loadedAt).not.toBeNull()
  })

  test('coalesces concurrent background fetch requests for the same repo', async () => {
    seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFetch!: (value: { ok: true; message: string }) => void
    rpcHandlers['repo.fetch'] = () => {
      callCount += 1
      return new Promise<{ ok: true; message: string }>((resolve) => {
        resolveFetch = resolve
      })
    }

    const first = useReposStore.getState().backgroundFetch(REPO_ID)
    const second = useReposStore.getState().backgroundFetch(REPO_ID)

    expect(callCount).toBe(1)

    resolveFetch({ ok: true, message: 'ok' })
    await Promise.all([first, second])
  })

  test('allows a reopened repo to start a new background fetch while the old one is still settling', async () => {
    seedRepo([branch('feature/a')], 1)
    let callCount = 0
    const resolvers: Array<(value: { ok: true; message: string }) => void> = []
    rpcHandlers['repo.fetch'] = () => {
      callCount += 1
      return new Promise<{ ok: true; message: string }>((resolve) => {
        resolvers.push(resolve)
      })
    }
    rpcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('feature/reopened')],
      current: 'feature/reopened',
    })

    const oldFetch = useReposStore.getState().backgroundFetch(REPO_ID)
    useReposStore.getState().closeRepo(REPO_ID)
    const newToken = seedRepo([branch('feature/reopened')], 2)
    const newFetch = useReposStore.getState().backgroundFetch(REPO_ID)

    expect(callCount).toBe(2)

    await oldFetch
    const coalescedFetch = useReposStore.getState().backgroundFetch(REPO_ID)

    for (const resolve of resolvers.slice(1)) resolve({ ok: true, message: 'ok' })
    await Promise.allSettled([newFetch, coalescedFetch])

    expect(callCount).toBe(2)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(newToken)
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['feature/reopened'])
    expect(repo?.resources.fetch.loadedAt).not.toBeNull()
  })

  test('network operations expose repo-level fetch busy state', async () => {
    const token = seedRepo([branch('feature/a')])
    let resolveNetwork!: (value: { ok: true; message: string }) => void
    rpcHandlers['repo.fetch'] = () =>
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
    rpcHandlers['repo.fetch'] = async () => ({ ok: false, message: 'fatal: rejected' })
    rpcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
    }

    await useReposStore.getState().syncAndRefresh(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.events.at(-1)).toMatchObject({ kind: 'result', result: { ok: false, message: 'fatal: rejected' } })
    expect(snapshotCount).toBe(1)
  })

  test('manual sync records thrown fetch failures instead of rejecting', async () => {
    const token = seedRepo([branch('feature/a')])
    rpcHandlers['repo.fetch'] = async () => {
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
    rpcHandlers['repo.pull'] = () =>
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
    rpcHandlers['repo.checkout'] = () =>
      new Promise<{ ok: true; message: string }>((resolve) => {
        resolveCheckout = resolve
      })
    rpcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
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
    rpcHandlers['repo.createWorktree'] = async () => ({ ok: true, message: 'ok' })
    rpcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('main'), branch('feature/a')], current: 'main' }
    }

    const result = await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/worktrees/feature-a',
        newBranch: 'feature/a',
        baseBranch: 'main',
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
    rpcHandlers['repo.createWorktree'] = async () => ({ ok: false, message: 'error.invalid-path' })
    rpcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('main'), branch('feature/a')], current: 'main' }
    }

    const result = await useReposStore.getState().runBranchAction(
      REPO_ID,
      {
        kind: 'createWorktree',
        worktreePath: '/tmp/worktrees/feature-a',
        newBranch: 'feature/a',
        baseBranch: 'main',
      },
      { token, refreshOnError: false },
    )

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(snapshotCount).toBe(0)
  })

  test('deferred branch action results skip toast and refresh until caller confirms follow-up', async () => {
    const token = seedRepo([branch('feature/a')])
    let snapshotCount = 0
    rpcHandlers['repo.deleteBranch'] = async () => ({ ok: false, message: 'error.branch-not-fully-merged' })
    rpcHandlers['repo.snapshot'] = async () => {
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
    rpcHandlers['repo.checkout'] = async () => ({ ok: false, message: 'error.checkout-failed' })
    rpcHandlers['repo.snapshot'] = async () => {
      snapshotCount += 1
      return { branches: [branch('feature/a')], current: 'feature/a' }
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
    rpcHandlers['repo.pull'] = async () => ({ ok: false, message: 'fatal: rejected' })

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
    rpcHandlers['repo.removeWorktree'] = async () => {
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
  test('refreshAll refreshes snapshot and status, then visible commits log', async () => {
    const token = seedRepo([branch('old')])
    const calls: string[] = []
    updateRepoForTest((repo) => {
      repo.ui.detailTab = 'commits'
      repo.ui.selectedBranch = 'old'
    })
    rpcHandlers['repo.snapshot'] = async () => {
      calls.push('snapshot')
      return { branches: [branch('main')], current: 'main' }
    }
    rpcHandlers['repo.status'] = async () => {
      calls.push('status')
      return []
    }
    rpcHandlers['repo.log'] = async ({ branch: branchName }: { branch: string }) => {
      calls.push(`log:${branchName}`)
      return []
    }

    await useReposStore.getState().refreshAll(REPO_ID, { token })

    expect(calls).toEqual(['snapshot', 'status', 'log:main'])
  })

  test('refreshAll skips log refresh when commits are not visible', async () => {
    const token = seedRepo([branch('main')])
    let logCalls = 0
    updateRepoForTest((repo) => {
      repo.ui.detailTab = 'status'
    })
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('main')], current: 'main' })
    rpcHandlers['repo.log'] = async () => {
      logCalls += 1
      return []
    }

    await useReposStore.getState().refreshAll(REPO_ID, { token })

    expect(logCalls).toBe(0)
  })

  test('refreshAll stops after snapshot when the repo is reopened', async () => {
    const token = seedRepo([branch('old')], 1)
    let statusCalls = 0
    let logCalls = 0
    rpcHandlers['repo.snapshot'] = async () => {
      seedRepo([branch('reopened')], 2)
      return { branches: [branch('stale')], current: 'stale' }
    }
    rpcHandlers['repo.status'] = async () => {
      statusCalls += 1
      return []
    }
    rpcHandlers['repo.log'] = async () => {
      logCalls += 1
      return []
    }

    await useReposStore.getState().refreshAll(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['reopened'])
    expect(statusCalls).toBe(0)
    expect(logCalls).toBe(0)
  })

  test('refreshAll marks deleted or non-git paths unavailable and skips follow-up reads', async () => {
    const token = seedRepo([branch('main')])
    let statusCalls = 0
    rpcHandlers['repo.snapshot'] = async () => {
      throw new Error('error.not-git-repo')
    }
    rpcHandlers['repo.status'] = async () => {
      statusCalls += 1
      return []
    }

    await useReposStore.getState().refreshAll(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.availability).toMatchObject({ phase: 'unavailable', reason: 'error.not-git-repo' })
    expect(repo?.resources.snapshot.error).toBe('error.not-git-repo')
    expect(statusCalls).toBe(0)
  })

  test('refreshSnapshot restores an unavailable repo when the path is a git repo again', async () => {
    const token = seedRepo([branch('old')])
    updateRepoForTest((repo) => {
      repo.availability = { phase: 'unavailable', reason: 'error.path-not-found', checkedAt: Date.now() }
    })
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('main')], current: 'main' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.availability).toEqual({ phase: 'available' })
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['main'])
    expect(repo?.resources.snapshot.error).toBeNull()
  })

  test('refreshAll stops before log when the repo is reopened after status', async () => {
    const token = seedRepo([branch('main')], 1)
    let logCalls = 0
    updateRepoForTest((repo) => {
      repo.ui.detailTab = 'commits'
    })
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('main')], current: 'main' })
    rpcHandlers['repo.status'] = async () => {
      seedRepo([branch('reopened')], 2)
      return []
    }
    rpcHandlers['repo.log'] = async () => {
      logCalls += 1
      return []
    }

    await useReposStore.getState().refreshAll(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.instanceToken).toBe(2)
    expect(repo?.data.branches.map((b) => b.name)).toEqual(['reopened'])
    expect(logCalls).toBe(0)
  })

  test('ignores stale status refreshes for the same repo instance', async () => {
    const token = seedRepo([branch('feature/a')])
    let callCount = 0
    let resolveFirst!: (value: WorktreeStatus[]) => void
    let resolveSecond!: (value: WorktreeStatus[]) => void
    rpcHandlers['repo.status'] = () => {
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
    rpcHandlers['repo.status'] = async () => [
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
    rpcHandlers['repo.snapshot'] = async () => ({
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
    rpcHandlers['repo.snapshot'] = async () => ({
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
    rpcHandlers['repo.status'] = () =>
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

    rpcHandlers['repo.status'] = async () => {
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
    rpcHandlers['repo.status'] = () =>
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
    rpcHandlers['repo.abort'] = async () => ({ ok: true, message: 'ok' })
    rpcHandlers['repo.status'] = () => {
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
    rpcHandlers['repo.status'] = () =>
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
    rpcHandlers['repo.snapshot'] = () => {
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

  test('snapshot refresh prunes stale log data and operations for deleted branches', async () => {
    const token = seedRepo([branch('stale'), branch('fresh')])
    updateRepoForTest((repo) => {
      repo.data.logsByBranch = {
        stale: { entries: [], selectedHash: null, hasMore: false },
        fresh: { entries: [], selectedHash: null, hasMore: false },
      }
      repo.resources.logsByBranch = {
        stale: { phase: 'loading', loadedAt: null, error: null, stale: false },
        fresh: { phase: 'loading', loadedAt: null, error: null, stale: false },
      }
    })
    markRepoOperationTargets(
      REPO_ID,
      1,
      [
        { key: 'log:stale', reason: 'log' },
        { key: 'log:fresh', reason: 'log' },
      ],
      'running',
    )
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('fresh')], current: 'fresh' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(Object.keys(repo?.data.logsByBranch ?? {})).toEqual(['fresh'])
    expect(Object.keys(repo?.resources.logsByBranch ?? {})).toEqual(['fresh'])
    expect(repoOperation(REPO_ID, 'log:stale').phase).toBe('idle')
    expect(repoOperation(REPO_ID, 'log:fresh').phase).toBe('running')
  })

  test('snapshot refresh falls back from terminal tab when selected branch loses its worktree', async () => {
    const token = seedRepo([branch('main', undefined, { worktree: { path: '/repo' } }), branch('feature/a')])
    updateRepoForTest((repo) => {
      repo.ui.selectedBranch = 'feature/a'
      repo.ui.detailTab = 'terminal'
    })
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('feature/a')], current: 'feature/a' })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/a')
    expect(repo?.ui.detailTab).toBe('status')
  })

  test('snapshot refresh prunes terminal sessions to current worktree paths', async () => {
    const token = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
    const calls: TerminalPruneRepoInput[] = []
    overrideTerminalBridge({
      pruneRepo: async (input) => {
        calls.push(input)
        return true
      },
    })
    rpcHandlers['repo.snapshot'] = async () => ({
      branches: [
        branch('main', undefined, { worktree: { path: '/repo' } }),
        branch('feature/a', undefined, { worktree: { path: '/tmp/worktree-a' } }),
        branch('feature/plain'),
      ],
      current: 'main',
    })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })

    expect(calls).toEqual([{ repoRoot: REPO_ID, worktreePaths: ['/repo', '/tmp/worktree-a'] }])
    const worktreesByPath = useReposStore.getState().repos[REPO_ID]?.data.worktreesByPath
    expect(worktreesByPath?.['/tmp/stale-worktree']).toBeUndefined()
    expect(Object.keys(worktreesByPath ?? {}).sort()).toEqual(['/repo', '/tmp/worktree-a'])
  })

  test('snapshot refresh warns when pruning terminal sessions fails', async () => {
    const token = seedRepo([branch('stale', undefined, { worktree: { path: '/tmp/stale-worktree' } })])
    const err = new Error('prune failed')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    overrideTerminalBridge({
      pruneRepo: async () => {
        throw err
      },
    })
    rpcHandlers['repo.snapshot'] = async () => ({
      branches: [branch('main', undefined, { worktree: { path: '/repo' } })],
      current: 'main',
    })

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await Promise.resolve()

    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to prune repo sessions', err)
  })

  test('snapshot refresh backfills the visible branch log when commits are open', async () => {
    const token = seedRepo([branch('main')])
    const logCalls: string[] = []
    updateRepoForTest((repo) => {
      repo.ui.detailTab = 'commits'
    })
    rpcHandlers['repo.snapshot'] = async () => ({ branches: [branch('main')], current: 'main' })
    rpcHandlers['repo.log'] = async ({ branch: branchName }: { branch: string }) => {
      logCalls.push(branchName)
      return []
    }

    await useReposStore.getState().refreshSnapshot(REPO_ID, { token })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(logCalls).toEqual(['main'])
  })

  test('branch log refresh loads the initial page and tracks whether more commits exist', async () => {
    const token = seedRepo([branch('main')])
    let input: { count?: number; skip?: number } | undefined
    rpcHandlers['repo.log'] = async (args: { count?: number; skip?: number }) => {
      input = args
      return Array.from({ length: INITIAL_LOG_COUNT + 1 }, (_, i) => logEntry(i))
    }

    await useReposStore.getState().refreshBranchLog(REPO_ID, 'main', { token })

    const log = useReposStore.getState().repos[REPO_ID]?.data.logsByBranch.main
    expect(input).toMatchObject({ count: INITIAL_LOG_COUNT + 1, skip: 0 })
    expect(log?.entries).toHaveLength(INITIAL_LOG_COUNT)
    expect(log?.selectedHash).toBe('hash-0')
    expect(log?.hasMore).toBe(true)
    expect(repoOperation(REPO_ID, 'log:main').phase).toBe('idle')
  })

  test('loadMoreBranchLog appends the next page', async () => {
    const token = seedRepo([branch('main')])
    updateRepoForTest((repo) => {
      repo.data.logsByBranch.main = {
        entries: Array.from({ length: INITIAL_LOG_COUNT }, (_, i) => logEntry(i)),
        selectedHash: 'hash-0',
        hasMore: true,
      }
    })
    let input: { count?: number; skip?: number } | undefined
    rpcHandlers['repo.log'] = async (args: { count?: number; skip?: number }) => {
      input = args
      return Array.from({ length: LOG_PAGE_SIZE + 1 }, (_, i) => logEntry(INITIAL_LOG_COUNT + i))
    }

    await useReposStore.getState().loadMoreBranchLog(REPO_ID, 'main', { token })

    const log = useReposStore.getState().repos[REPO_ID]?.data.logsByBranch.main
    expect(input).toMatchObject({ count: LOG_PAGE_SIZE + 1, skip: INITIAL_LOG_COUNT })
    expect(log?.entries).toHaveLength(INITIAL_LOG_COUNT + LOG_PAGE_SIZE)
    expect(log?.entries.at(-1)?.hash).toBe(`hash-${INITIAL_LOG_COUNT + LOG_PAGE_SIZE - 1}`)
    expect(log?.selectedHash).toBe('hash-0')
    expect(log?.hasMore).toBe(true)
  })

  test('branch log refresh returns before scheduling work for unknown branches', async () => {
    const token = seedRepo([branch('main')])
    let logCalls = 0
    rpcHandlers['repo.log'] = async () => {
      logCalls += 1
      return []
    }

    await useReposStore.getState().refreshBranchLog(REPO_ID, 'missing', { token })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(logCalls).toBe(0)
    expect(repo?.data.logsByBranch.missing).toBeUndefined()
    expect(repoOperation(REPO_ID, 'log:missing').phase).toBe('idle')
  })
})
