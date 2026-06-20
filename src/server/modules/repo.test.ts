import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'

const mocks = vi.hoisted(() => ({
  checkGitAvailable: vi.fn(),
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
  getUpstream: vi.fn(),
  getWorktrees: vi.fn(),
  isAncestor: vi.fn(),
  fetchAll: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn(),
  removeWorktree: vi.fn(),
  runServerCancellable: vi.fn(),
  setBackgroundSyncRepos: vi.fn(),
  publishRepoQueryInvalidation: vi.fn(),
}))

vi.mock('#/system/git/branches.ts', () => ({
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
  getRemoteTrackingBranches: vi.fn(async () => ['origin/main', 'origin/feature/a']),
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
  fetchRemoteRepository: vi.fn(),
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

describe('getRepositorySnapshot', () => {
  test('reads git state directly without publishing invalidation', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([])
    const snapshot = repoSnapshot('fresh')
    mocks.getBranches.mockResolvedValueOnce(snapshot.branches)
    mocks.getCurrentBranch.mockResolvedValueOnce(snapshot.current)
    mocks.getRemoteInfo.mockResolvedValueOnce(snapshot.remote)

    const { getRepositorySnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepositorySnapshot('/tmp/repo')

    expect(result).toEqual(snapshot)
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
})

describe('getRepositoryPullRequests', () => {
  test('reads pull requests directly from the backend', async () => {
    const fresh: PullRequestEntry[] = [{ branch: 'feature/a', pullRequest: pullRequest(1) }]
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(1)]]))
    const { getRepositoryPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepositoryPullRequests('/tmp/repo', ['feature/a'], { mode: 'full' })

    expect(result).toEqual(fresh)
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('returns single-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(2)]]))

    const { getRepositoryPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepositoryPullRequests('/tmp/repo', ['feature/a'], { mode: 'summary' })

    expect(result).toEqual([{ branch: 'feature/a', pullRequest: pullRequest(2) }])
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('returns multi-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(
      new Map([
        ['feature/a', pullRequest(3)],
        ['feature/b', pullRequest(4)],
      ]),
    )

    const { getRepositoryPullRequests } = await import('#/server/modules/repo-read-paths.ts')
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
    mocks.runServerCancellable.mockImplementationOnce(
      async (_cwd, _kind, task) => await task(new AbortController().signal),
    )
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepository } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepository('/tmp/repo', kind as 'user' | 'background')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expect(mocks.fetchAll).toHaveBeenCalledWith('/tmp/repo', expect.any(AbortSignal))
  })

  test('publishes snapshot invalidation after a successful sync', async () => {
    mocks.runServerCancellable.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepository } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepository('/tmp/repo', 'user')

    expect(result).toEqual({ ok: true, message: 'fetched' })
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

    const { fetchRepository } = await import('#/server/modules/repo-write-paths.ts')
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
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(1)
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('does not publish invalidations after a failed sync', async () => {
    mocks.runServerCancellable.mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })

    const { fetchRepository } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepository('/tmp/repo', 'background')

    expect(result).toEqual({ ok: false, message: 'fatal: offline' })
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })
})

describe('probeRepository path errors', () => {
  test('reports missing paths specifically', async () => {
    mocks.fsStat.mockRejectedValueOnce({ code: 'ENOENT' })

    const { probeRepository } = await import('#/server/modules/repo-read-paths.ts')
    await expect(probeRepository('/tmp/missing')).resolves.toEqual({ ok: false, message: 'error.path-not-found' })
  })

  test('reports non-directory paths specifically', async () => {
    mocks.fsStat.mockResolvedValueOnce({ isDirectory: () => false })

    const { probeRepository } = await import('#/server/modules/repo-read-paths.ts')
    await expect(probeRepository('/tmp/file')).resolves.toEqual({ ok: false, message: 'error.path-not-directory' })
  })

  test('reports permission-denied paths specifically', async () => {
    mocks.fsAccess.mockRejectedValueOnce({ code: 'EACCES' })

    const { probeRepository } = await import('#/server/modules/repo-read-paths.ts')
    await expect(probeRepository('/tmp/private')).resolves.toEqual({
      ok: false,
      message: 'error.path-permission-denied',
    })
  })
})

describe('repo mutation invalidation publishing', () => {
  test.each([
    [
      'pullRepositoryBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepositoryBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'createRepositoryWorktree',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.createRepositoryWorktree('/tmp/repo', {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s publishes snapshot invalidation after success', async (_name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test.each([
    [
      'pullRepositoryBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepositoryBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
  ])('%s runs inside the repo network-op gate', async (_name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.runServerCancellable).toHaveBeenCalledWith('/tmp/repo', 'user', expect.any(Function))
  })

  test.each([
    [
      'pullRepositoryBranch',
      () => mocks.pullBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: pull failed' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepositoryBranch',
      () => mocks.pushBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: push failed' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepositoryBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'createRepositoryWorktree',
      () => mocks.createWorktree.mockResolvedValueOnce({ ok: false, message: 'fatal: worktree failed' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.createRepositoryWorktree('/tmp/repo', {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s does not publish snapshot invalidation after failure', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo-write-paths.ts')

    await run(repo)

    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('createRepositoryWorktree rejects non-absolute paths before calling git', async () => {
    const { createRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepositoryWorktree('/tmp/repo', {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(mocks.createWorktree).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('createRepositoryWorktree rejects malformed mode input', async () => {
    const { createRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepositoryWorktree('/tmp/repo', {
      worktreePath: '/tmp/repo-worktree',
      // @ts-expect-error — exercise the runtime normalization path
      mode: { kind: 'unknown' },
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(mocks.createWorktree).not.toHaveBeenCalled()
  })

  test('deleteRepositoryBranch publishes snapshot invalidation after success', async () => {
    const { deleteRepositoryBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepositoryBranch('/tmp/repo', 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('deleteRepositoryBranch refuses protected branches before touching git', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('feature/current')
    const { deleteRepositoryBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepositoryBranch('/tmp/repo', 'main')

    expect(result).toEqual({ ok: false, message: 'error.cannot-delete-protected-branch' })
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('deleteRepositoryBranch uses current HEAD semantics for safe deletes', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.getWorktrees.mockResolvedValueOnce([])
    mocks.isAncestor.mockImplementationOnce(async (_cwd, _branch, descendant) => descendant === 'release/1.0')
    mocks.getUpstream.mockResolvedValueOnce(null)
    const { deleteRepositoryBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepositoryBranch('/tmp/repo', 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'release/1.0', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
  })

  test('deleteRepositoryBranch does not publish snapshot invalidation after failure', async () => {
    mocks.deleteBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: delete failed' })
    const { deleteRepositoryBranch } = await import('#/server/modules/repo-write-paths.ts')

    await deleteRepositoryBranch('/tmp/repo', 'feature/a')

    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('removeRepositoryWorktree publishes snapshot invalidations for affected worktrees after removal success', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ])
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(1, {
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(2, {
      repoId: '/tmp/repo-worktree',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(2)
  })

  test('removeRepositoryWorktree publishes affected snapshot invalidations once after worktree and branch deletion success', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ])
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(1, {
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(2, {
      repoId: '/tmp/repo-worktree',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(2)
  })

  test('removeRepositoryWorktree publishes affected invalidations after branch deletion fails post-removal', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ]
    mocks.getWorktrees.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)
    mocks.deleteBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: delete failed' })
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: false, message: 'fatal: delete failed' })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', undefined)
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(1, {
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(2, {
      repoId: '/tmp/repo-worktree',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(2)
  })

  test('removeRepositoryWorktree can remove and delete the currently opened linked worktree', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-linked',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ]
    mocks.getWorktrees.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree(
      '/tmp/repo-linked',
      {
        branch: 'feature/a',
        worktreePath: '/tmp/repo-linked',
        alsoDeleteBranch: true,
      },
      undefined,
      'repo_branch_token',
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.getCurrentBranch).toHaveBeenCalledWith('/tmp/repo', { signal: undefined })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-linked', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(1, {
      repoId: '/tmp/repo-linked',
      query: 'repo-snapshot',
      sourceToken: 'repo_branch_token',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenNthCalledWith(2, {
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledTimes(2)
  })

  test('removeRepositoryWorktree refuses before removing when branch deletion would fail', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ])
    mocks.isAncestor.mockResolvedValueOnce(false)
    mocks.getUpstream.mockResolvedValueOnce(null)
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('removeRepositoryWorktree refuses locked worktrees before calling git remove', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        isLocked: true,
      },
    ])
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-locked-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('removeRepositoryWorktree refuses when worktree status could not be read', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    const { removeRepositoryWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepositoryWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })
})
