import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'

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
  getRepoCommonDir: vi.fn(),
  getRepoName: vi.fn(),
  getRepoRoot: vi.fn(),
  getRemoteInfo: vi.fn(),
  getUpstream: vi.fn(),
  getWorktrees: vi.fn(),
  isAncestor: vi.fn(),
  fetchAll: vi.fn(),
  cloneGitRepo: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn(),
  removeWorktree: vi.fn(),
  setBackgroundSyncRepos: vi.fn(),
  publishRepoQueryInvalidation: vi.fn(),
  publishSettingsInvalidation: vi.fn(),
  bootstrapWorktreeAfterCreate: vi.fn(),
  bootstrapRemoteWorktreeAfterCreate: vi.fn(),
  createRemoteWorktree: vi.fn(),
  deleteRemoteBranch: vi.fn(),
  fetchRemoteRepo: vi.fn(),
  getWorktreeBootstrapPreview: vi.fn(),
  getRemoteRepoWorktreePaths: vi.fn(),
  getRemoteRepoWriteGroupPath: vi.fn(),
  getRemoteWorktreeBootstrapPreview: vi.fn(),
  removeRemoteWorktree: vi.fn(),
  getServerRepoSettings: vi.fn(),
  pruneServerRepoSettingsForRemovedWorktree: vi.fn(),
  resolveRemoteTarget: vi.fn(),
  trustServerRepoWorktreeBootstrapConfig: vi.fn(),
  untrustServerRepoWorktreeBootstrapConfig: vi.fn(),
}))

vi.mock('#/system/git/branches.ts', () => ({
  deleteBranch: mocks.deleteBranch,
  deleteUpstreamBranch: mocks.deleteUpstreamBranch,
  getBranches: mocks.getBranches,
  getCurrentBranch: mocks.getCurrentBranch,
  getDefaultBranch: mocks.getDefaultBranch,
  getRepoCommonDir: mocks.getRepoCommonDir,
  getRepoName: mocks.getRepoName,
  getRepoRoot: mocks.getRepoRoot,
  getUpstream: mocks.getUpstream,
  isAncestor: mocks.isAncestor,
  isGitRepo: mocks.isGitRepo,
}))

vi.mock('#/system/git/git-exec.ts', () => ({
  checkGitAvailable: mocks.checkGitAvailable,
}))

vi.mock('#/system/git/clone.ts', () => ({
  cloneRepo: mocks.cloneGitRepo,
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

vi.mock('#/system/git/worktree-bootstrap.ts', () => ({
  bootstrapWorktreeAfterCreate: mocks.bootstrapWorktreeAfterCreate,
  getWorktreeBootstrapPreview: mocks.getWorktreeBootstrapPreview,
}))

vi.mock('#/shared/input-validation.ts', () => ({
  isValidCwd: () => true,
  isValidRepoLocator: () => true,
  toSafeRepoLocator: (value: unknown) => (typeof value === 'string' ? value : null),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerRepoSettings: mocks.getServerRepoSettings,
  pruneServerRepoSettingsForRemovedWorktree: mocks.pruneServerRepoSettingsForRemovedWorktree,
  trustServerRepoWorktreeBootstrapConfig: mocks.trustServerRepoWorktreeBootstrapConfig,
  untrustServerRepoWorktreeBootstrapConfig: mocks.untrustServerRepoWorktreeBootstrapConfig,
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: mocks.resolveRemoteTarget,
}))

vi.mock('#/system/ssh/diagnostics.ts', () => ({
  testRemoteRepo: vi.fn(),
}))

vi.mock('#/system/ssh/git.ts', () => ({
  bootstrapRemoteWorktreeAfterCreate: mocks.bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree: mocks.createRemoteWorktree,
  deleteRemoteBranch: mocks.deleteRemoteBranch,
  fetchRemoteRepo: mocks.fetchRemoteRepo,
  getRemoteBrowserUrl: vi.fn(),
  getRemoteLog: vi.fn(),
  getRemotePatch: vi.fn(),
  getRemoteRepoWorktreePaths: mocks.getRemoteRepoWorktreePaths,
  getRemoteRepoWriteGroupPath: mocks.getRemoteRepoWriteGroupPath,
  getRemoteSnapshot: vi.fn(),
  getRemoteStatus: vi.fn(),
  getRemoteTrackingBranches: vi.fn(),
  getRemoteWorktreeBootstrapPreview: mocks.getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch: vi.fn(),
  pushRemoteBranch: vi.fn(),
  removeRemoteWorktree: mocks.removeRemoteWorktree,
}))

vi.mock('#/system/git/pull-requests.ts', () => ({
  getBranchPullRequests: mocks.getBranchPullRequests,
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: mocks.publishRepoQueryInvalidation,
  publishSettingsInvalidation: mocks.publishSettingsInvalidation,
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
}))

beforeEach(async () => {
  const { resetRepoServerOperationRegistryForTests } = await import('#/server/modules/repo-operation-registry.ts')
  const { resetRepoWriteOperationCoordinatorForTests } =
    await import('#/server/modules/repo-write-operation-coordinator.ts')
  resetRepoServerOperationRegistryForTests()
  resetRepoWriteOperationCoordinatorForTests()
  vi.clearAllMocks()
  mocks.checkGitAvailable.mockResolvedValue({ ok: true, message: '' })
  mocks.fsStat.mockResolvedValue({ isDirectory: () => true })
  mocks.fsAccess.mockResolvedValue(undefined)
  mocks.fsMkdir.mockResolvedValue(undefined)
  mocks.isGitRepo.mockResolvedValue(true)
  mocks.pullBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.pushBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.cloneGitRepo.mockResolvedValue({ ok: true, message: 'ok', path: '/tmp/repo' })
  mocks.createWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.createRemoteWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.bootstrapWorktreeAfterCreate.mockResolvedValue({ ok: true, message: '' })
  mocks.bootstrapRemoteWorktreeAfterCreate.mockResolvedValue({ ok: true, message: '' })
  mocks.getWorktreeBootstrapPreview.mockResolvedValue({
    ok: true,
    preview: {
      hasConfig: false,
      hasOperations: false,
      configHash: null,
      copyCount: 0,
      symlinkCount: 0,
      hardlinkCount: 0,
      excludeCount: 0,
    },
  })
  mocks.getRemoteWorktreeBootstrapPreview.mockResolvedValue({
    ok: true,
    preview: {
      hasConfig: false,
      hasOperations: false,
      configHash: null,
      copyCount: 0,
      symlinkCount: 0,
      hardlinkCount: 0,
      excludeCount: 0,
    },
  })
  mocks.getServerRepoSettings.mockResolvedValue([])
  mocks.pruneServerRepoSettingsForRemovedWorktree.mockResolvedValue(false)
  mocks.resolveRemoteTarget.mockResolvedValue({
    target: {
      id: normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' }),
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
  })
  mocks.trustServerRepoWorktreeBootstrapConfig.mockResolvedValue([])
  mocks.untrustServerRepoWorktreeBootstrapConfig.mockResolvedValue(true)
  mocks.deleteBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.deleteUpstreamBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.removeWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.deleteRemoteBranch.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.removeRemoteWorktree.mockResolvedValue({ ok: true, message: 'ok' })
  mocks.fetchRemoteRepo.mockResolvedValue({ ok: true, message: 'fetched' })
  mocks.getRemoteRepoWorktreePaths.mockResolvedValue([])
  mocks.getRemoteRepoWriteGroupPath.mockImplementation(async (target: { remotePath: string }) => target.remotePath)
  mocks.getCurrentBranch.mockResolvedValue('main')
  mocks.getRepoCommonDir.mockImplementation(async (cwd: string) => `${cwd}/.git`)
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
        lastCommitHash: 'hash-000000000000000000000000000000000000',
        lastCommitShortHash: 'hash-0',
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

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

type TestRepoQueryInvalidation = { repoId: string; query: 'repo-snapshot' | 'repo-runtime' }
type TestRepoSnapshotInvalidation = { repoId: string; query: 'repo-snapshot' }

function repoQueryInvalidationEvents(): TestRepoQueryInvalidation[] {
  return mocks.publishRepoQueryInvalidation.mock.calls.map(([event]) => event as TestRepoQueryInvalidation)
}

function repoSnapshotInvalidations(): TestRepoSnapshotInvalidation[] {
  return repoQueryInvalidationEvents().filter(
    (event): event is TestRepoSnapshotInvalidation => event.query === 'repo-snapshot',
  )
}

function expectRepoSnapshotInvalidations(...events: TestRepoSnapshotInvalidation[]): void {
  expect(repoSnapshotInvalidations()).toEqual(events)
}

function expectNoRepoSnapshotInvalidations(): void {
  expectRepoSnapshotInvalidations()
}

describe('getRepoSnapshot', () => {
  test('reads git state directly without publishing invalidation', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([])
    const snapshot = repoSnapshot('fresh')
    mocks.getBranches.mockResolvedValueOnce(snapshot.branches)
    mocks.getCurrentBranch.mockResolvedValueOnce(snapshot.current)
    mocks.getRemoteInfo.mockResolvedValueOnce(snapshot.remote)

    const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoSnapshot('/tmp/repo')

    expect(result).toEqual(snapshot)
    expectNoRepoSnapshotInvalidations()
  })
})

describe('getRepoPullRequests', () => {
  test('reads pull requests directly from the backend', async () => {
    const fresh: PullRequestEntry[] = [{ branch: 'feature/a', pullRequest: pullRequest(1) }]
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(1)]]))
    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests('/tmp/repo', ['feature/a'], { mode: 'full' })

    expect(result).toEqual(fresh)
    expectNoRepoSnapshotInvalidations()
  })

  test('returns single-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(2)]]))

    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests('/tmp/repo', ['feature/a'], { mode: 'summary' })

    expect(result).toEqual([{ branch: 'feature/a', pullRequest: pullRequest(2) }])
    expectNoRepoSnapshotInvalidations()
  })

  test('returns multi-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(
      new Map([
        ['feature/a', pullRequest(3)],
        ['feature/b', pullRequest(4)],
      ]),
    )

    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests('/tmp/repo', ['feature/a', 'feature/b'], { mode: 'full' })

    expect(result).toEqual([
      { branch: 'feature/a', pullRequest: pullRequest(3) },
      { branch: 'feature/b', pullRequest: pullRequest(4) },
    ])
    expectNoRepoSnapshotInvalidations()
  })
})

describe('fetchRepo invalidation publishing', () => {
  test.each([
    ['user', 'user'],
    ['background', 'background'],
  ])('%s sync fetches prune stale remote-tracking refs', async (_name, kind) => {
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo('/tmp/repo', kind as 'user' | 'background')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expect(mocks.fetchAll).toHaveBeenCalledWith('/tmp/repo', expect.any(AbortSignal))
  })

  test('merges caller abort signal into fetch operations', async () => {
    const caller = new AbortController()
    mocks.fetchAll.mockImplementationOnce(async (_cwd: string, signal?: AbortSignal) => {
      expect(signal?.aborted).toBe(false)
      caller.abort('stopped')
      expect(signal?.aborted).toBe(true)
      return { ok: false, message: 'cancelled' }
    })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo('/tmp/repo', 'user', caller.signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expectNoRepoSnapshotInvalidations()
  })

  test('publishes snapshot invalidation after a successful sync', async () => {
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo('/tmp/repo', 'user')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expectRepoSnapshotInvalidations({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('publishes sibling worktree snapshot invalidations after a successful sync', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false, isDirty: false },
    ])
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo('/tmp/repo', 'user')

    expect(result).toEqual({ ok: true, message: 'fetched' })
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-linked',
        query: 'repo-snapshot',
      },
    )
  })

  test('user sync waits for an active background sync before fetching', async () => {
    const backgroundFetch = deferred<{ ok: true; message: string }>()
    mocks.fetchAll.mockImplementationOnce(() => backgroundFetch.promise)
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched by user' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo('/tmp/repo', 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo('/tmp/repo', 'user')

    backgroundFetch.resolve({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched by user' })
    expect(mocks.fetchAll).toHaveBeenCalledTimes(2)
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
    )
  })

  test('user sync waits for an active sibling worktree background sync before fetching', async () => {
    mocks.getRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.getWorktrees.mockResolvedValue([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-linked', branch: 'feature/a', isBare: false, isPrimary: false, isDirty: false },
    ])
    const fetch = deferred<{ ok: true; message: string }>()
    mocks.fetchAll.mockImplementationOnce(() => fetch.promise)
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched by user' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo('/tmp/repo', 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo('/tmp/repo-linked', 'user')

    fetch.resolve({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched by user' })
    expect(mocks.fetchAll).toHaveBeenCalledTimes(2)
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-linked',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-linked',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
    )
  })

  test('user sync waits for an active remote background sync with the same alias', async () => {
    const repoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValue(['/srv/repo', '/srv/repo-linked'])
    const fetch = deferred<{ ok: true; message: string }>()
    mocks.fetchRemoteRepo.mockImplementationOnce(async () => await fetch.promise)
    mocks.fetchRemoteRepo.mockResolvedValueOnce({ ok: true, message: 'fetched by user' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo(repoId, 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo(linkedRepoId, 'user')

    fetch.resolve({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched by user' })
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2)
    expectRepoSnapshotInvalidations(
      {
        repoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
      {
        repoId,
        query: 'repo-snapshot',
      },
    )
  })

  test('user sync waits for an active linked remote background sync with the same alias', async () => {
    const repoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValue(['/srv/repo', '/srv/repo-linked'])
    const fetch = deferred<{ ok: true; message: string }>()
    mocks.fetchRemoteRepo.mockImplementationOnce(async () => await fetch.promise)
    mocks.fetchRemoteRepo.mockResolvedValueOnce({ ok: true, message: 'fetched by user' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo(linkedRepoId, 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(1)
    })
    const user = fetchRepo(repoId, 'user')

    fetch.resolve({ ok: true, message: 'fetched in background' })
    const [backgroundResult, userResult] = await Promise.all([background, user])

    expect(backgroundResult).toEqual({ ok: true, message: 'fetched in background' })
    expect(userResult).toEqual({ ok: true, message: 'fetched by user' })
    expect(mocks.fetchRemoteRepo).toHaveBeenCalledTimes(2)
    expectRepoSnapshotInvalidations(
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
      {
        repoId,
        query: 'repo-snapshot',
      },
      {
        repoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
    )
  })

  test('caller abort cancels a queued user sync without cancelling the active background sync', async () => {
    const fetch = deferred<{ ok: true; message: string }>()
    mocks.fetchAll.mockImplementationOnce(() => fetch.promise)

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const background = fetchRepo('/tmp/repo', 'background')
    await vi.waitFor(() => {
      expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    })

    const caller = new AbortController()
    const user = fetchRepo('/tmp/repo', 'user', caller.signal)
    caller.abort('client disconnected')

    await expect(user).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(mocks.fetchAll).toHaveBeenCalledTimes(1)
    expectNoRepoSnapshotInvalidations()

    fetch.resolve({ ok: true, message: 'fetched in background' })
    await expect(background).resolves.toEqual({ ok: true, message: 'fetched in background' })
    expectRepoSnapshotInvalidations({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('caller abort records wait cancellation for a queued user sync', async () => {
    const deleteBranch = deferred<{ ok: true; message: string }>()
    mocks.deleteBranch.mockImplementationOnce(async () => await deleteBranch.promise)
    mocks.fetchAll.mockResolvedValueOnce({ ok: true, message: 'fetched' })

    const { deleteRepoBranch, fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const write = deleteRepoBranch('/tmp/repo', 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })

    const background = fetchRepo('/tmp/repo', 'background')
    await vi.waitFor(async () => {
      expect((await readRepoOperationsSnapshot('/tmp/repo')).operations).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'fetch', phase: 'queued' })]),
      )
    })

    const caller = new AbortController()
    const user = fetchRepo('/tmp/repo', 'user', caller.signal)
    await vi.waitFor(async () => {
      expect((await readRepoOperationsSnapshot('/tmp/repo')).operations).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'fetch', phase: 'queued', source: 'user' })]),
      )
    })
    caller.abort('client disconnected')

    await expect(user).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(mocks.fetchAll).not.toHaveBeenCalled()
    await expect(readRepoOperationsSnapshot('/tmp/repo', { includeSettled: true })).resolves.toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({
          kind: 'fetch',
          source: 'user',
          phase: 'failed',
          cancellation: expect.objectContaining({
            waitCancelledCount: 1,
            lastWaitCancellationReason: 'caller-abort',
          }),
          error: expect.objectContaining({
            message: 'cancelled',
            reason: 'caller-abort',
          }),
        }),
      ]),
    })

    deleteBranch.resolve({ ok: true, message: 'deleted' })
    await expect(write).resolves.toEqual({ ok: true, message: 'deleted' })
    await expect(background).resolves.toEqual({ ok: true, message: 'fetched' })
  })

  test('does not publish invalidations after a failed sync', async () => {
    mocks.fetchAll.mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })

    const { fetchRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await fetchRepo('/tmp/repo', 'background')

    expect(result).toEqual({ ok: false, message: 'fatal: offline' })
    expectNoRepoSnapshotInvalidations()
  })
})

describe('cloneRepo cancellation', () => {
  test('returns cancelled before clone preflight side effects when caller is already aborted', async () => {
    const caller = new AbortController()
    caller.abort('client disconnected')

    const { cloneRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await cloneRepo('https://example.com/repo.git', '/tmp', 'repo', caller.signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
    expect(mocks.checkGitAvailable).not.toHaveBeenCalled()
    expect(mocks.fsMkdir).not.toHaveBeenCalled()
    expect(mocks.cloneGitRepo).not.toHaveBeenCalled()
  })

  test('merges caller abort signal into clone operations', async () => {
    const caller = new AbortController()
    mocks.cloneGitRepo.mockImplementationOnce(
      async (_parentPath: string, _directoryName: string, _url: string, signal) => {
        expect(signal?.aborted).toBe(false)
        caller.abort('stopped')
        expect(signal?.aborted).toBe(true)
        return { ok: false, message: 'cancelled' }
      },
    )

    const { cloneRepo } = await import('#/server/modules/repo-write-paths.ts')
    const result = await cloneRepo('https://example.com/repo.git', '/tmp', 'repo', caller.signal)

    expect(result).toEqual({ ok: false, message: 'cancelled' })
  })

  test('records clone operation state and structured caller cancellation', async () => {
    mocks.cloneGitRepo.mockImplementationOnce(
      (_parentPath: string, _directoryName: string, _url: string, signal?: AbortSignal) =>
        new Promise((resolve) => {
          signal?.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }))
        }),
    )
    const { cloneRepo } = await import('#/server/modules/repo-write-paths.ts')
    const { listRepoServerOperations } = await import('#/server/modules/repo-operation-registry.ts')
    const caller = new AbortController()

    const work = cloneRepo('https://example.com/repo.git', '/tmp', 'repo', caller.signal)
    let operationId = ''
    await vi.waitFor(() => {
      const operation = listRepoServerOperations({ includeSettled: true }).find(
        (operation) => operation.kind === 'clone',
      )
      expect(operation).toMatchObject({
        kind: 'clone',
        phase: 'running',
        target: { parentPath: '/tmp', directoryName: 'repo' },
      })
      operationId = operation!.id
    })

    caller.abort('stopped')
    await expect(work).resolves.toEqual({ ok: false, message: 'cancelled' })
    expect(
      listRepoServerOperations({ includeSettled: true }).find((operation) => operation.id === operationId),
    ).toMatchObject({
      kind: 'clone',
      phase: 'failed',
      cancellation: {
        underlyingRequested: true,
        reason: 'caller-abort',
      },
      error: {
        message: 'cancelled',
        reason: 'caller-abort',
      },
    })
  })
})

describe('probeRepo path errors', () => {
  test('reports missing paths specifically', async () => {
    mocks.fsStat.mockRejectedValueOnce({ code: 'ENOENT' })

    const { probeRepo } = await import('#/server/modules/repo-read-paths.ts')
    await expect(probeRepo('/tmp/missing')).resolves.toEqual({ ok: false, message: 'error.path-not-found' })
  })

  test('reports non-directory paths specifically', async () => {
    mocks.fsStat.mockResolvedValueOnce({ isDirectory: () => false })

    const { probeRepo } = await import('#/server/modules/repo-read-paths.ts')
    await expect(probeRepo('/tmp/file')).resolves.toEqual({ ok: false, message: 'error.path-not-directory' })
  })

  test('reports permission-denied paths specifically', async () => {
    mocks.fsAccess.mockRejectedValueOnce({ code: 'EACCES' })

    const { probeRepo } = await import('#/server/modules/repo-read-paths.ts')
    await expect(probeRepo('/tmp/private')).resolves.toEqual({
      ok: false,
      message: 'error.path-permission-denied',
    })
  })
})

describe('repo mutation invalidation publishing', () => {
  test.each([
    [
      'pullRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'createRepoWorktree',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.createRepoWorktree('/tmp/repo', {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s publishes snapshot invalidation after success', async (_name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(repoSnapshotInvalidations()).toContainEqual({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('createRepoWorktree publishes snapshot invalidations for existing siblings and the new worktree', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-linked', branch: 'feature/b', isBare: false, isPrimary: false, isDirty: false },
    ])
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree('/tmp/repo', {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-linked',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-worktree',
        query: 'repo-snapshot',
      },
    )
  })

  test('createRepoWorktree skips bootstrap unless run is explicitly requested', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree('/tmp/repo', {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.bootstrapWorktreeAfterCreate).not.toHaveBeenCalled()
  })

  test('schema rejects run bootstrap decisions without a configTrusted state', async () => {
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    const { REPO_PROCEDURE_SCHEMAS } = await import('#/shared/procedure-schemas.ts')

    expect(() =>
      parseHttpInput(REPO_PROCEDURE_SCHEMAS.createWorktree, {
        cwd: '/tmp/repo',
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        worktreeBootstrap: {
          kind: 'run',
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    ).toThrow()
  })

  test('createRepoWorktree allows one-time bootstrap run requests without trusted repo settings', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: false,
        },
      },
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.createWorktree).toHaveBeenCalled()
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: configHash,
    })
    expect(mocks.getServerRepoSettings).toHaveBeenCalledTimes(1)
    expect(mocks.trustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
  })

  test('createRepoWorktree clears existing bootstrap trust when the create request leaves trust unchecked', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mocks.getServerRepoSettings.mockResolvedValueOnce([
      {
        repoId: '/tmp/repo',
        worktreeBootstrapTrust: {
          configHash,
          trustedAt: '2026-06-26T00:00:00.000Z',
        },
      },
    ])
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: false,
        },
      },
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: configHash,
    })
    expect(mocks.trustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).toHaveBeenCalledWith({ repoId: '/tmp/repo', configHash })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })

  test('createRepoWorktree reports settings failure when clearing bootstrap trust fails after bootstrap succeeds', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mocks.getServerRepoSettings.mockResolvedValueOnce([
      {
        repoId: '/tmp/repo',
        worktreeBootstrapTrust: {
          configHash,
          trustedAt: '2026-06-26T00:00:00.000Z',
        },
      },
    ])
    mocks.untrustServerRepoWorktreeBootstrapConfig.mockRejectedValueOnce(new Error('settings write failed'))
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: false,
        },
      },
    )

    expect(result).toEqual({ ok: false, message: 'error.settings-write-title', repoChanged: true })
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).toHaveBeenCalledWith({ repoId: '/tmp/repo', configHash })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('createRepoWorktree stores bootstrap trust after bootstrap succeeds', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: true,
        },
      },
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.createWorktree).toHaveBeenCalled()
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: configHash,
    })
    expect(mocks.trustServerRepoWorktreeBootstrapConfig).toHaveBeenCalledWith({ repoId: '/tmp/repo', configHash })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
    expect(mocks.bootstrapWorktreeAfterCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.trustServerRepoWorktreeBootstrapConfig.mock.invocationCallOrder[0],
    )
  })

  test('createRepoWorktree serializes concurrent repo write service operations for the same repo', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const firstCreate = deferred<{ ok: true; message: string }>()
    const secondCreate = deferred<{ ok: true; message: string }>()
    mocks.createWorktree
      .mockImplementationOnce(async () => await firstCreate.promise)
      .mockImplementationOnce(async () => await secondCreate.promise)
    mocks.getServerRepoSettings.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        repoId: '/tmp/repo',
        worktreeBootstrapTrust: {
          configHash,
          trustedAt: '2026-06-26T00:00:00.000Z',
        },
      },
    ])
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const first = createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree-a',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: true,
        },
      },
    )
    await vi.waitFor(() => {
      expect(mocks.createWorktree).toHaveBeenCalledTimes(1)
    })
    expect(
      (await readRepoOperationsSnapshot('/tmp/repo')).operations.find(
        (operation) => operation.target?.branch === 'feature/a',
      ),
    ).toMatchObject({
      kind: 'create-worktree',
      phase: 'running',
      target: { branch: 'feature/a', worktreePath: '/tmp/repo-worktree-a' },
    })

    const second = createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree-b',
        mode: { kind: 'newBranch', newBranch: 'feature/b', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: false,
        },
      },
    )
    await vi.waitFor(async () => {
      expect(
        (await readRepoOperationsSnapshot('/tmp/repo')).operations.find(
          (operation) => operation.target?.branch === 'feature/b',
        ),
      ).toMatchObject({ phase: 'queued' })
    })
    expect(mocks.createWorktree).toHaveBeenCalledTimes(1)
    expect(
      (await readRepoOperationsSnapshot('/tmp/repo')).operations.find(
        (operation) => operation.target?.branch === 'feature/b',
      ),
    ).toMatchObject({
      kind: 'create-worktree',
      phase: 'queued',
      target: { branch: 'feature/b', worktreePath: '/tmp/repo-worktree-b' },
    })

    firstCreate.resolve({ ok: true, message: 'first created' })
    await expect(first).resolves.toEqual({ ok: true, message: 'first created' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.createWorktree).toHaveBeenCalledTimes(2)

    secondCreate.resolve({ ok: true, message: 'second created' })
    await expect(second).resolves.toEqual({ ok: true, message: 'second created' })
    expect((await readRepoOperationsSnapshot('/tmp/repo')).operations).toEqual([])
    expect(
      (await readRepoOperationsSnapshot('/tmp/repo', { includeSettled: true })).operations.filter(
        (operation) => operation.kind === 'create-worktree',
      ),
    ).toHaveLength(2)

    expect(mocks.createWorktree.mock.calls[0]?.[1]).toMatchObject({ worktreePath: '/tmp/repo-worktree-a' })
    expect(mocks.createWorktree.mock.calls[1]?.[1]).toMatchObject({ worktreePath: '/tmp/repo-worktree-b' })
    expect(mocks.trustServerRepoWorktreeBootstrapConfig).toHaveBeenCalledWith({ repoId: '/tmp/repo', configHash })
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).toHaveBeenCalledWith({ repoId: '/tmp/repo', configHash })
    expect(mocks.trustServerRepoWorktreeBootstrapConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createWorktree.mock.invocationCallOrder[1],
    )
    expect(mocks.createWorktree.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.untrustServerRepoWorktreeBootstrapConfig.mock.invocationCallOrder[0],
    )
  })

  test('repo write service operations serialize across mutation kinds for the same repo', async () => {
    const firstDelete = deferred<{ ok: true; message: string }>()
    const secondRemove = deferred<{ ok: true; message: string }>()
    mocks.getWorktrees.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/b',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ])
    mocks.deleteBranch.mockImplementationOnce(async () => await firstDelete.promise)
    mocks.removeWorktree.mockImplementationOnce(async () => await secondRemove.promise)
    const { deleteRepoBranch, removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const first = deleteRepoBranch('/tmp/repo', 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })
    expect(
      (await readRepoOperationsSnapshot('/tmp/repo')).operations.find(
        (operation) => operation.kind === 'delete-branch',
      ),
    ).toMatchObject({
      kind: 'delete-branch',
      phase: 'running',
      target: { branch: 'feature/a' },
    })

    const second = removeRepoWorktree('/tmp/repo', {
      branch: 'feature/b',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(
      (await readRepoOperationsSnapshot('/tmp/repo')).operations.find(
        (operation) => operation.kind === 'remove-worktree',
      ),
    ).toMatchObject({
      kind: 'remove-worktree',
      phase: 'queued',
      target: { branch: 'feature/b', worktreePath: '/tmp/repo-worktree' },
    })

    firstDelete.resolve({ ok: true, message: 'deleted' })
    await expect(first).resolves.toEqual({ ok: true, message: 'deleted' })
    await vi.waitFor(() => {
      expect(mocks.removeWorktree).toHaveBeenCalledTimes(1)
    })

    secondRemove.resolve({ ok: true, message: 'removed' })
    await expect(second).resolves.toEqual({ ok: true, message: 'removed' })
    expect((await readRepoOperationsSnapshot('/tmp/repo')).operations).toEqual([])
  })

  test('repo write service operations serialize linked worktree repo ids by common git dir', async () => {
    const firstDelete = deferred<{ ok: true; message: string }>()
    const secondRemove = deferred<{ ok: true; message: string }>()
    mocks.getRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.getWorktrees.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      {
        path: '/tmp/repo-linked',
        branch: 'feature/b',
        isBare: false,
        isPrimary: false,
        isDirty: false,
        changeCount: 0,
      },
    ])
    mocks.deleteBranch.mockImplementationOnce(async () => await firstDelete.promise)
    mocks.removeWorktree.mockImplementationOnce(async () => await secondRemove.promise)
    const { deleteRepoBranch, removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const first = deleteRepoBranch('/tmp/repo', 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })
    await expect(readRepoOperationsSnapshot('/tmp/repo-linked')).resolves.toMatchObject({
      operations: [
        expect.objectContaining({
          repoId: '/tmp/repo',
          kind: 'delete-branch',
          phase: 'running',
          target: { branch: 'feature/a' },
        }),
      ],
    })

    const second = removeRepoWorktree('/tmp/repo-linked', {
      branch: 'feature/b',
      worktreePath: '/tmp/repo-linked',
      alsoDeleteBranch: false,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(
      (await readRepoOperationsSnapshot('/tmp/repo-linked')).operations.find(
        (operation) => operation.kind === 'remove-worktree',
      ),
    ).toMatchObject({
      kind: 'remove-worktree',
      phase: 'queued',
      target: { branch: 'feature/b', worktreePath: '/tmp/repo-linked' },
    })

    firstDelete.resolve({ ok: true, message: 'deleted' })
    await expect(first).resolves.toEqual({ ok: true, message: 'deleted' })
    await vi.waitFor(() => {
      expect(mocks.removeWorktree).toHaveBeenCalledTimes(1)
    })

    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-linked', undefined)
    secondRemove.resolve({ ok: true, message: 'removed' })
    await expect(second).resolves.toEqual({ ok: true, message: 'removed' })
  })

  test('repo write service operations serialize linked worktree network mutations by common git dir', async () => {
    const firstDelete = deferred<{ ok: true; message: string }>()
    const secondPull = deferred<{ ok: true; message: string }>()
    mocks.getRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.deleteBranch.mockImplementationOnce(async () => await firstDelete.promise)
    mocks.pullBranch.mockImplementationOnce(async () => await secondPull.promise)
    const { deleteRepoBranch, pullRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const first = deleteRepoBranch('/tmp/repo', 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })

    const second = pullRepoBranch('/tmp/repo-linked', 'feature/b')
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.pullBranch).not.toHaveBeenCalled()

    firstDelete.resolve({ ok: true, message: 'deleted' })
    await expect(first).resolves.toEqual({ ok: true, message: 'deleted' })
    await vi.waitFor(() => {
      expect(mocks.pullBranch).toHaveBeenCalledTimes(1)
    })

    secondPull.resolve({ ok: true, message: 'pulled' })
    await expect(second).resolves.toEqual({ ok: true, message: 'pulled' })
  })

  test('createRepoWorktree reports settings failure after creating and bootstrapping the worktree', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mocks.trustServerRepoWorktreeBootstrapConfig.mockRejectedValueOnce(new Error('settings write failed'))
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: true,
        },
      },
    )

    expect(result).toEqual({ ok: false, message: 'error.settings-write-title', repoChanged: true })
    expect(mocks.createWorktree).toHaveBeenCalled()
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: configHash,
    })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo-worktree',
      query: 'repo-snapshot',
    })
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
  })

  test.each([
    [
      'pullRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepoBranch('/tmp/repo', 'feature/a'),
    ],
  ])('%s records the network mutation in the repo write coordinator', async (name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')
    const { listRepoWriteOperationsForRepo } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(name === 'pullRepoBranch' ? mocks.pullBranch : mocks.pushBranch).toHaveBeenCalled()
    await expect(listRepoWriteOperationsForRepo('/tmp/repo', { includeSettled: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^repo-write-op-/),
          kind: name === 'pullRepoBranch' ? 'pull' : 'push',
          phase: 'done',
          source: 'user',
          target: expect.objectContaining({ branch: 'feature/a' }),
        }),
      ]),
    )
  })

  test.each([
    [
      'pullRepoBranch',
      () => mocks.pullBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: pull failed' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepoBranch',
      () => mocks.pushBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: push failed' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'createRepoWorktree',
      () => mocks.createWorktree.mockResolvedValueOnce({ ok: false, message: 'fatal: worktree failed' }),
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.createRepoWorktree('/tmp/repo', {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s does not publish snapshot invalidation after failure', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo-write-paths.ts')

    await run(repo)

    expectNoRepoSnapshotInvalidations()
  })

  test('createRepoWorktree publishes invalidation when bootstrap fails after git created the worktree', async () => {
    mocks.getServerRepoSettings.mockResolvedValueOnce([
      {
        repoId: '/tmp/repo',
        worktreeBootstrapTrust: {
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          trustedAt: '2026-06-26T00:00:00.000Z',
        },
      },
    ])
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          configTrusted: false,
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      repoChanged: true,
    })
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo-worktree',
      query: 'repo-snapshot',
    })
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
  })

  test('createRepoWorktree publishes remote invalidation when bootstrap fails after remote worktree creation', async () => {
    const repoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' })
    const worktreeRepoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.createRemoteWorktree.mockResolvedValueOnce({
      ok: true,
      message: 'created',
      affectedWorktreePaths: ['/srv/repo-feature'],
    })
    mocks.bootstrapRemoteWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      repoId,
      {
        worktreePath: '/srv/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          configTrusted: false,
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      repoChanged: true,
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId,
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: worktreeRepoId,
      query: 'repo-snapshot',
    })
  })

  test('createRepoWorktree does not store bootstrap trust when bootstrap fails', async () => {
    const configHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      '/tmp/repo',
      {
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: true,
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      repoChanged: true,
    })
    expect(mocks.trustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
    expect(mocks.untrustServerRepoWorktreeBootstrapConfig).not.toHaveBeenCalled()
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('createRepoWorktree rejects non-absolute paths before calling git', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree('/tmp/repo', {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(mocks.createWorktree).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('createRepoWorktree rejects malformed mode input', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree('/tmp/repo', {
      worktreePath: '/tmp/repo-worktree',
      // @ts-expect-error — exercise the runtime normalization path
      mode: { kind: 'unknown' },
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(mocks.createWorktree).not.toHaveBeenCalled()
  })

  test('deleteRepoBranch publishes snapshot invalidation after success', async () => {
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const result = await deleteRepoBranch('/tmp/repo', 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect((await readRepoOperationsSnapshot('/tmp/repo')).operations).toEqual([])
    expect((await readRepoOperationsSnapshot('/tmp/repo', { includeSettled: true })).operations[0]).toMatchObject({
      kind: 'delete-branch',
      phase: 'done',
      target: { branch: 'feature/a' },
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
  })

  test('remote deleteRepoBranch forwards upstream deletion and refreshes affected remote worktrees after partial failure', async () => {
    const repoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValueOnce(['/srv/repo', '/srv/repo-linked'])
    mocks.deleteRemoteBranch.mockResolvedValueOnce({
      ok: false,
      message: 'remote rejected delete',
      repoChanged: true,
    })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(repoId, 'feature/a', { alsoDeleteUpstream: true })

    expect(result).toEqual({ ok: false, message: 'remote rejected delete', repoChanged: true })
    expect(mocks.deleteRemoteBranch).toHaveBeenCalledWith(expect.objectContaining({ remotePath: '/srv/repo' }), {
      branch: 'feature/a',
      force: undefined,
      alsoDeleteUpstream: true,
      signal: undefined,
    })
    expectRepoSnapshotInvalidations(
      {
        repoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
    )
  })

  test.each([
    [
      'pullRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pullRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'pushRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.pushRepoBranch('/tmp/repo', 'feature/a'),
    ],
    [
      'deleteRepoBranch',
      async (repo: typeof import('#/server/modules/repo-write-paths.ts')) =>
        repo.deleteRepoBranch('/tmp/repo', 'feature/a'),
    ],
  ])('%s publishes sibling worktree snapshot invalidations after success', async (_name, run) => {
    mocks.getWorktrees.mockResolvedValue([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-linked', branch: 'feature/b', isBare: false, isPrimary: false, isDirty: false },
    ])
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-linked',
        query: 'repo-snapshot',
      },
    )
  })

  test('deleteRepoBranch refuses protected branches before touching git', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('feature/current')
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch('/tmp/repo', 'main')

    expect(result).toEqual({ ok: false, message: 'error.cannot-delete-protected-branch' })
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('deleteRepoBranch uses current HEAD semantics for safe deletes', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.getWorktrees.mockResolvedValueOnce([])
    mocks.isAncestor.mockImplementationOnce(async (_cwd, _branch, descendant) => descendant === 'release/1.0')
    mocks.getUpstream.mockResolvedValueOnce(null)
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch('/tmp/repo', 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'release/1.0', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
  })

  test('deleteRepoBranch does not publish snapshot invalidation after failure', async () => {
    mocks.deleteBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: delete failed' })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    await deleteRepoBranch('/tmp/repo', 'feature/a')

    expectNoRepoSnapshotInvalidations()
  })

  test('removeRepoWorktree publishes snapshot invalidations for affected worktrees after removal success', async () => {
    mocks.removeWorktree.mockResolvedValueOnce({
      ok: true,
      message: 'ok',
    })
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
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect((await readRepoOperationsSnapshot('/tmp/repo')).operations).toEqual([])
    expect((await readRepoOperationsSnapshot('/tmp/repo', { includeSettled: true })).operations[0]).toMatchObject({
      kind: 'remove-worktree',
      phase: 'done',
      target: { branch: 'feature/a', worktreePath: '/tmp/repo-worktree' },
    })
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-worktree',
        query: 'repo-snapshot',
      },
    )
  })

  test('removeRepoWorktree publishes affected snapshot invalidations once after worktree and branch deletion success', async () => {
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
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-worktree',
        query: 'repo-snapshot',
      },
    )
  })

  test('removeRepoWorktree publishes affected invalidations after branch deletion fails post-removal', async () => {
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
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: false, message: 'fatal: delete failed' })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', undefined)
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo-worktree',
        query: 'repo-snapshot',
      },
    )
  })

  test('removeRepoWorktree can remove and delete the currently opened linked worktree', async () => {
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
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo-linked', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-linked',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.getCurrentBranch).toHaveBeenCalledWith('/tmp/repo', { signal: undefined })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-linked', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
    expectRepoSnapshotInvalidations(
      {
        repoId: '/tmp/repo-linked',
        query: 'repo-snapshot',
      },
      {
        repoId: '/tmp/repo',
        query: 'repo-snapshot',
      },
    )
    expect(mocks.pruneServerRepoSettingsForRemovedWorktree).toHaveBeenCalledWith({
      repoId: '/tmp/repo-linked',
      worktreePath: '/tmp/repo-linked',
    })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree publishes settings invalidation when worktree-scoped settings are pruned', async () => {
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
    mocks.pruneServerRepoSettingsForRemovedWorktree.mockResolvedValueOnce(true)
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.pruneServerRepoSettingsForRemovedWorktree).toHaveBeenCalledWith({
      repoId: '/tmp/repo',
      worktreePath: '/tmp/repo-worktree',
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })

  test('removeRepoWorktree refuses before removing when branch deletion would fail', async () => {
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
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: true,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('removeRepoWorktree refuses locked worktrees before calling git remove', async () => {
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
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-locked-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree refuses when worktree status could not be read', async () => {
    mocks.getWorktrees.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true, isDirty: false },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    const { removeRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await removeRepoWorktree('/tmp/repo', {
      branch: 'feature/a',
      worktreePath: '/tmp/repo-worktree',
      alsoDeleteBranch: false,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })
})
