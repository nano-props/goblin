import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/rpc.ts'

const mocks = vi.hoisted(() => ({
  checkGitAvailable: vi.fn(),
  checkoutBranch: vi.fn(),
  createWorktree: vi.fn(),
  deleteBranch: vi.fn(),
  deleteUpstreamBranch: vi.fn(),
  fsAccess: vi.fn(),
  fsMkdir: vi.fn(),
  fsStat: vi.fn(),
  isGitRepo: vi.fn(),
  getBranches: vi.fn(),
  getBranchPullRequests: vi.fn(),
  getCurrentBranch: vi.fn(),
  getDefaultBranch: vi.fn(),
  getRepoName: vi.fn(),
  getRepoRoot: vi.fn(),
  getRemoteInfo: vi.fn(),
  getRemoteTrackingBranches: vi.fn(),
  getUpstream: vi.fn(),
  getWorktrees: vi.fn(),
  isAncestor: vi.fn(),
  fetchAll: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  invalidateCachedRepoReadModel: vi.fn(),
  pullBranch: vi.fn(),
  readCachedPullRequests: vi.fn(),
  readCachedRepoSnapshot: vi.fn(),
  pushBranch: vi.fn(),
  removeWorktree: vi.fn(),
  runServerCancellable: vi.fn(),
  setBackgroundSyncRepos: vi.fn(),
  writeCachedPullRequests: vi.fn(),
  writeCachedRepoSnapshot: vi.fn(),
  publishRepoQueryInvalidation: vi.fn(),
}))

vi.mock('#/system/git/branches.ts', () => ({
  checkoutBranch: mocks.checkoutBranch,
  deleteBranch: mocks.deleteBranch,
  deleteUpstreamBranch: mocks.deleteUpstreamBranch,
  getBranches: mocks.getBranches,
  getCurrentBranch: mocks.getCurrentBranch,
  getDefaultBranch: mocks.getDefaultBranch,
  getRepoName: mocks.getRepoName,
  getRepoRoot: mocks.getRepoRoot,
  getUpstream: mocks.getUpstream,
  isAncestor: mocks.isAncestor,
  isGitRepo: mocks.isGitRepo,
}))

vi.mock('#/system/git/helper.ts', () => ({
  checkGitAvailable: mocks.checkGitAvailable,
}))

vi.mock('node:fs', () => ({
  promises: {
    access: mocks.fsAccess,
    mkdir: mocks.fsMkdir,
    stat: mocks.fsStat,
  },
  constants: {
    R_OK: 4,
    W_OK: 2,
  },
}))

vi.mock('#/system/git/remote.ts', () => ({
  fetchAll: mocks.fetchAll,
  getRemoteInfo: mocks.getRemoteInfo,
  pullBranch: mocks.pullBranch,
  pushBranch: mocks.pushBranch,
}))

vi.mock('#/system/git/remote-refs.ts', () => ({
  getRemoteTrackingBranches: mocks.getRemoteTrackingBranches,
}))

vi.mock('#/system/git/status.ts', () => ({
  getWorkingStatus: vi.fn(),
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  createWorktree: mocks.createWorktree,
  getWorktrees: mocks.getWorktrees,
  removeWorktree: mocks.removeWorktree,
}))

vi.mock('#/shared/input-validation.ts', () => ({
  isValidCwd: () => true,
  isValidRepoLocator: () => true,
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: vi.fn(),
}))

vi.mock('#/system/ssh/diagnostics.ts', () => ({
  testRemoteRepository: vi.fn(),
}))

vi.mock('#/system/ssh/git.ts', () => ({
  createRemoteWorktree: vi.fn(),
  fetchRemoteRepository: vi.fn(),
  getRemoteTrackingBranches: vi.fn(),
  getRemoteLog: vi.fn(),
  getRemoteSnapshot: vi.fn(),
  getRemoteStatus: vi.fn(),
}))

vi.mock('#/system/git/pull-requests.ts', () => ({
  getBranchPullRequests: mocks.getBranchPullRequests,
}))

vi.mock('#/server/common/network-ops.ts', () => ({
  runServerCancellable: mocks.runServerCancellable,
  abortServerNetworkOp: vi.fn(),
}))

vi.mock('#/server/modules/repo-read-model.ts', () => ({
  invalidateCachedRepoReadModel: mocks.invalidateCachedRepoReadModel,
  readCachedPullRequests: mocks.readCachedPullRequests,
  readCachedRepoSnapshot: mocks.readCachedRepoSnapshot,
  writeCachedPullRequests: mocks.writeCachedPullRequests,
  writeCachedRepoSnapshot: mocks.writeCachedRepoSnapshot,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: mocks.publishRepoQueryInvalidation,
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runServerCancellable.mockImplementation(async (_cwd, _kind, task) => await task(new AbortController().signal))
  mocks.checkGitAvailable.mockResolvedValue({ ok: true, message: '' })
  mocks.fsStat.mockResolvedValue({ isDirectory: () => true })
  mocks.fsAccess.mockResolvedValue(undefined)
  mocks.fsMkdir.mockResolvedValue(undefined)
  mocks.isGitRepo.mockResolvedValue(true)
  mocks.checkoutBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.pullBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.pushBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.createWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.deleteBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.deleteUpstreamBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.removeWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.getCurrentBranch.mockResolvedValue('main')
  mocks.getRepoName.mockResolvedValue('repo')
  mocks.getRepoRoot.mockResolvedValue('/tmp/repo')
  mocks.getWorktrees.mockResolvedValue([])
  mocks.getRemoteTrackingBranches.mockResolvedValue([])
  mocks.getDefaultBranch.mockResolvedValue('main')
  mocks.getUpstream.mockResolvedValue(null)
  mocks.isAncestor.mockResolvedValue(true)
})

afterEach(() => {
  vi.resetModules()
})

function repoSnapshot(branch = 'main'): RepoSnapshot {
  return {
    branches: [
      {
        name: branch,
        isCurrent: true,
        ahead: 0,
        behind: 0,
        lastCommitHash: 'hash-0',
        lastCommitMessage: 'commit 0',
        lastCommitDate: '2024-01-01T00:00:00.000Z',
        lastCommitAuthor: 'dev',
      },
    ],
    current: branch,
  }
}

function pullRequest(number: number): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://example.com/pr/${number}`,
    state: 'open',
  }
}

describe('getRepositorySnapshot read model', () => {
  test('returns a cached snapshot without re-reading git state', async () => {
    const cached = repoSnapshot('cached')
    mocks.readCachedRepoSnapshot.mockResolvedValueOnce(cached)

    const { getRepositorySnapshot } = await import('#/server/modules/repo.ts')
    const result = await getRepositorySnapshot('/tmp/repo')

    expect(result).toEqual(cached)
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.writeCachedRepoSnapshot).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('writes a snapshot after an uncached read', async () => {
    mocks.readCachedRepoSnapshot.mockResolvedValueOnce(null)
    mocks.getWorktrees.mockResolvedValueOnce([])
    const snapshot = repoSnapshot('fresh')
    mocks.getBranches.mockResolvedValueOnce(snapshot.branches)
    mocks.getCurrentBranch.mockResolvedValueOnce(snapshot.current)
    mocks.getRemoteInfo.mockResolvedValueOnce(snapshot.remote)

    const { getRepositorySnapshot } = await import('#/server/modules/repo.ts')
    const result = await getRepositorySnapshot('/tmp/repo')

    expect(result).toEqual(snapshot)
    expect(mocks.writeCachedRepoSnapshot).toHaveBeenCalledWith('/tmp/repo', snapshot)
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
})

describe('getRepositoryPullRequests read model', () => {
  test('returns cached pull requests for requested branches without refetching', async () => {
    const cached: PullRequestEntry[] = [{ branch: 'feature/a', pullRequest: pullRequest(1) }]
    mocks.readCachedPullRequests.mockResolvedValueOnce(cached)

    const { getRepositoryPullRequests } = await import('#/server/modules/repo.ts')
    const result = await getRepositoryPullRequests('/tmp/repo', ['feature/a'], { mode: 'full' })

    expect(result).toEqual(cached)
    expect(mocks.getBranchPullRequests).not.toHaveBeenCalled()
    expect(mocks.writeCachedPullRequests).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('writes single-branch pull requests after an uncached read without publishing invalidation', async () => {
    mocks.readCachedPullRequests.mockResolvedValueOnce(undefined)
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(2)]]))

    const { getRepositoryPullRequests } = await import('#/server/modules/repo.ts')
    const result = await getRepositoryPullRequests('/tmp/repo', ['feature/a'], { mode: 'summary' })

    expect(result).toEqual([{ branch: 'feature/a', pullRequest: pullRequest(2) }])
    expect(mocks.writeCachedPullRequests).toHaveBeenCalledWith(
      '/tmp/repo',
      [{ branch: 'feature/a', pullRequest: pullRequest(2) }],
      { branches: ['feature/a'], mode: 'summary' },
    )
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('writes multi-branch pull requests after an uncached read without publishing invalidation', async () => {
    mocks.readCachedPullRequests.mockResolvedValueOnce(undefined)
    mocks.getBranchPullRequests.mockResolvedValueOnce(
      new Map([
        ['feature/a', pullRequest(3)],
        ['feature/b', pullRequest(4)],
      ]),
    )

    const { getRepositoryPullRequests } = await import('#/server/modules/repo.ts')
    const result = await getRepositoryPullRequests('/tmp/repo', ['feature/a', 'feature/b'], { mode: 'full' })

    expect(result).toEqual([
      { branch: 'feature/a', pullRequest: pullRequest(3) },
      { branch: 'feature/b', pullRequest: pullRequest(4) },
    ])
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
})

describe('fetchRepository invalidation publishing', () => {
  test.each([
    ['user', 'user'],
    ['background', 'background'],
  ])('%s sync fetches prune stale remote-tracking refs', async (_name, kind) => {
    mocks.runServerCancellable.mockImplementationOnce(async (_cwd, _kind, task) => await task(new AbortController().signal))
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepository } = await import('#/server/modules/repo.ts')
    const result = await fetchRepository('/tmp/repo', kind as 'user' | 'background')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expect(mocks.fetchAll).toHaveBeenCalledWith('/tmp/repo', expect.any(AbortSignal))
  })

  test('publishes snapshot invalidation after a successful sync', async () => {
    mocks.runServerCancellable.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepository } = await import('#/server/modules/repo.ts')
    const result = await fetchRepository('/tmp/repo', 'user')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expect(mocks.invalidateCachedRepoReadModel).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(1, {
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(1)
  })

  test('user sync waits for and reuses an active background sync result without duplicating invalidation', async () => {
    let resolveFetch!: (value: { ok: true; message: string }) => void
    mocks.runServerCancellable.mockImplementation(async (_cwd, _kind, task) => await task(new AbortController().signal))
    mocks.fetchAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )

    const { fetchRepository } = await import('#/server/modules/repo.ts')
    const background = fetchRepository('/tmp/repo', 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepository('/tmp/repo', 'user')

    resolveFetch({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(mocks.runServerCancellable).toHaveBeenCalledTimes(1)
    expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    expect(mocks.invalidateCachedRepoReadModel).toHaveBeenCalledTimes(1)
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(1)
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('does not publish invalidations after a failed sync', async () => {
    mocks.runServerCancellable.mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })

    const { fetchRepository } = await import('#/server/modules/repo.ts')
    const result = await fetchRepository('/tmp/repo', 'background')

    expect(result).toEqual({ ok: false, message: 'fatal: offline' })
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
})

describe('probeRepository path errors', () => {
  test('reports missing paths specifically', async () => {
    mocks.fsStat.mockRejectedValueOnce({ code: 'ENOENT' })

    const { probeRepository } = await import('#/server/modules/repo.ts')
    await expect(probeRepository('/tmp/missing')).resolves.toEqual({ ok: false, message: 'error.path-not-found' })
  })

  test('reports non-directory paths specifically', async () => {
    mocks.fsStat.mockResolvedValueOnce({ isDirectory: () => false })

    const { probeRepository } = await import('#/server/modules/repo.ts')
    await expect(probeRepository('/tmp/file')).resolves.toEqual({ ok: false, message: 'error.path-not-directory' })
  })

  test('reports permission-denied paths specifically', async () => {
    mocks.fsAccess.mockRejectedValueOnce({ code: 'EACCES' })

    const { probeRepository } = await import('#/server/modules/repo.ts')
    await expect(probeRepository('/tmp/private')).resolves.toEqual({ ok: false, message: 'error.path-permission-denied' })
  })
})

describe('repo mutation invalidation publishing', () => {
  test('createRepositoryWorktree passes object-shaped input to the backend and publishes source-token invalidation', async () => {
    const { createRepositoryWorktree } = await import('#/server/modules/repo.ts')

    const result = await createRepositoryWorktree(
      '/tmp/repo',
      { worktreePath: '/tmp/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      undefined,
      'repo_branch_test',
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.createWorktree).toHaveBeenCalledWith(
      '/tmp/repo',
      { worktreePath: '/tmp/repo-feature', mode: { kind: 'existingBranch', branch: 'feature/a' } },
      undefined,
    )
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
      sourceToken: 'repo_branch_test',
    })
  })

  test('getRepositoryRemoteBranches returns local remote-tracking refs', async () => {
    mocks.getRemoteTrackingBranches.mockResolvedValueOnce(['origin/main', 'origin/feature/a'])
    const { getRepositoryRemoteBranches } = await import('#/server/modules/repo.ts')

    await expect(getRepositoryRemoteBranches('/tmp/repo')).resolves.toEqual(['origin/main', 'origin/feature/a'])
    expect(mocks.getRemoteTrackingBranches).toHaveBeenCalledWith('/tmp/repo', undefined)
  })

  test.each([
    ['checkoutRepositoryBranch', async (repo: typeof import('#/server/modules/repo.ts')) => repo.checkoutRepositoryBranch('/tmp/repo', 'feature/a')],
    ['pullRepositoryBranch', async (repo: typeof import('#/server/modules/repo.ts')) => repo.pullRepositoryBranch('/tmp/repo', 'feature/a')],
    ['pushRepositoryBranch', async (repo: typeof import('#/server/modules/repo.ts')) => repo.pushRepositoryBranch('/tmp/repo', 'feature/a')],
    [
      'createRepositoryWorktree',
      async (repo: typeof import('#/server/modules/repo.ts')) =>
        repo.createRepositoryWorktree('/tmp/repo', {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s invalidates read-model after success', async (_name, run) => {
    const repo = await import('#/server/modules/repo.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.invalidateCachedRepoReadModel).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test.each([
    ['pullRepositoryBranch', async (repo: typeof import('#/server/modules/repo.ts')) => repo.pullRepositoryBranch('/tmp/repo', 'feature/a')],
    ['pushRepositoryBranch', async (repo: typeof import('#/server/modules/repo.ts')) => repo.pushRepositoryBranch('/tmp/repo', 'feature/a')],
  ])('%s runs inside the repo network-op gate', async (_name, run) => {
    const repo = await import('#/server/modules/repo.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.runServerCancellable).toHaveBeenCalledWith(
      '/tmp/repo',
      'user',
      expect.any(Function),
    )
  })

  test.each([
    [
      'checkoutRepositoryBranch',
      () => mocks.checkoutBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: checkout failed' }),
      async (repo: typeof import('#/server/modules/repo.ts')) => repo.checkoutRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pullRepositoryBranch',
      () => mocks.pullBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: pull failed' }),
      async (repo: typeof import('#/server/modules/repo.ts')) => repo.pullRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepositoryBranch',
      () => mocks.pushBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: push failed' }),
      async (repo: typeof import('#/server/modules/repo.ts')) => repo.pushRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'createRepositoryWorktree',
      () => mocks.createWorktree.mockResolvedValueOnce({ ok: false, message: 'fatal: worktree failed' }),
      async (repo: typeof import('#/server/modules/repo.ts')) =>
        repo.createRepositoryWorktree('/tmp/repo', {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s does not invalidate read-model after failure', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo.ts')

    await run(repo)

    expect(mocks.invalidateCachedRepoReadModel).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('deleteRepositoryBranch invalidates read-model after success', async () => {
    const { deleteRepositoryBranch } = await import('#/server/modules/repo.ts')

    const result = await deleteRepositoryBranch('/tmp/repo', 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.invalidateCachedRepoReadModel).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('deleteRepositoryBranch does not invalidate read-model after failure', async () => {
    mocks.deleteBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: delete failed' })
    const { deleteRepositoryBranch } = await import('#/server/modules/repo.ts')

    await deleteRepositoryBranch('/tmp/repo', 'feature/a')

    expect(mocks.invalidateCachedRepoReadModel).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('removeRepositoryWorktree invalidates read-model after worktree removal success', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([{ path: '/tmp/repo-worktree', branch: 'feature/a', isMain: false, changeCount: 0 }])
    const { removeRepositoryWorktree } = await import('#/server/modules/repo.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.invalidateCachedRepoReadModel).toHaveBeenCalledWith('/tmp/repo')
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('removeRepositoryWorktree invalidates read-model once after worktree and branch deletion success', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([{ path: '/tmp/repo-worktree', branch: 'feature/a', isMain: false, changeCount: 0 }])
    const { removeRepositoryWorktree } = await import('#/server/modules/repo.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.invalidateCachedRepoReadModel).toHaveBeenCalledTimes(1)
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(1)
  })
})
