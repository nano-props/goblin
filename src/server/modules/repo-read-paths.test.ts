import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import type { RepoSource } from '#/server/modules/repo-source.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import type { LogEntry, WorktreeStatus } from '#/shared/git-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

const mocks = vi.hoisted(() => ({
  runWithRepoMembershipReadAdmission: vi.fn(),
  runWithRepoSource: vi.fn(),
  listRepoWriteOperationsForRepo: vi.fn(),
  getRepoLastSuccessfulFetchAt: vi.fn(),
  resolveRepoWriteBoundaryForRead: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  runWithRepoSource: mocks.runWithRepoSource,
}))
vi.mock('#/server/modules/repo-write-operation-coordinator.ts', () => ({
  runWithRepoMembershipReadAdmission: mocks.runWithRepoMembershipReadAdmission,
  listRepoWriteOperationsForRepo: mocks.listRepoWriteOperationsForRepo,
  getRepoLastSuccessfulFetchAt: mocks.getRepoLastSuccessfulFetchAt,
  resolveRepoWriteBoundaryForRead: mocks.resolveRepoWriteBoundaryForRead,
}))

// Tests only need the read surface; cast to the full interface at the
// boundary so individual stub objects stay focused.
type SourceTask = (source: RepoSource) => Promise<unknown>
function asRepoSource(source: ReadSource): RepoSource {
  return source as unknown as RepoSource
}

type ReadSource = Pick<
  RepoSource,
  'id' | 'kind' | 'getSnapshot' | 'getStatus' | 'getPullRequests' | 'getLog' | 'fetch' | 'getWorktreeBootstrapPreview'
>

function makeSource(overrides: Partial<ReadSource> = {}): ReadSource {
  const base: ReadSource = {
    id: WORKSPACE_ID,
    kind: 'local',
    getSnapshot: () => Promise.resolve<RepoSnapshot | null>(null),
    getStatus: () => Promise.resolve<WorktreeStatus[]>([]),
    getPullRequests: () => Promise.resolve<PullRequestEntry[] | null>(null),
    getLog: () => Promise.resolve<LogEntry[]>([]),
    fetch: () => Promise.resolve({ ok: true, message: '' }),
    getWorktreeBootstrapPreview: () =>
      Promise.resolve({
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
      }),
  }
  return { ...base, ...overrides }
}

beforeEach(() => {
  mocks.runWithRepoMembershipReadAdmission.mockReset()
  mocks.runWithRepoMembershipReadAdmission.mockImplementation(async (_boundary, read: () => Promise<unknown>) => {
    return await read()
  })
  mocks.runWithRepoSource.mockReset()
  mocks.listRepoWriteOperationsForRepo.mockReset()
  mocks.listRepoWriteOperationsForRepo.mockResolvedValue([])
  mocks.getRepoLastSuccessfulFetchAt.mockReset()
  mocks.getRepoLastSuccessfulFetchAt.mockReturnValue(null)
  mocks.resolveRepoWriteBoundaryForRead.mockReset()
  mocks.resolveRepoWriteBoundaryForRead.mockResolvedValue({ id: 'test-boundary' })
  mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) => task(asRepoSource(makeSource())))
})

describe('getRepoLog', () => {
  test('reads branch history through the repo source', async () => {
    const entries: LogEntry[] = [
      {
        hash: '78c150a000000000000000000000000000000000',
        shortHash: '78c150a',
        refs: 'HEAD -> fix/w-tab',
        message: 'Fix branch navigator name truncation',
        author: 'Example Author',
        date: '2026-06-21T00:00:00.000Z',
      },
    ]
    const getLog = vi.fn(() => Promise.resolve(entries))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getLog }))),
    )
    const { getRepoLog } = await import('#/server/modules/repo-read-paths.ts')
    const signal = new AbortController().signal

    await expect(getRepoLog(WORKSPACE_ID, 'feature/work', { count: 30, skip: 0, signal })).resolves.toEqual(entries)
    expect(getLog).toHaveBeenCalledWith('feature/work', { count: 30, skip: 0, signal })
  })

  test('uses the shared default branch history count', async () => {
    const getLog = vi.fn(() => Promise.resolve<LogEntry[]>([]))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getLog }))),
    )
    const { getRepoLog } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepoLog(WORKSPACE_ID, 'feature/work')).resolves.toEqual([])
    expect(getLog).toHaveBeenCalledWith('feature/work', { count: 100, skip: 0, signal: undefined })
  })
})

describe('getRepoWorktreeBootstrapPreview', () => {
  test('reads bootstrap preview through the repo source', async () => {
    const getWorktreeBootstrapPreview = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        preview: {
          hasConfig: true,
          hasOperations: true,
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          copyCount: 1,
          symlinkCount: 0,
          hardlinkCount: 0,
          excludeCount: 0,
        },
      }),
    )
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getWorktreeBootstrapPreview }))),
    )
    const { getRepoWorktreeBootstrapPreview } = await import('#/server/modules/repo-read-paths.ts')
    const signal = new AbortController().signal

    await expect(getRepoWorktreeBootstrapPreview(WORKSPACE_ID, { signal })).resolves.toMatchObject({
      ok: true,
      preview: { hasOperations: true },
    })
    expect(getWorktreeBootstrapPreview).toHaveBeenCalledWith(signal)
  })
})

const EMPTY_REMOTE: RepoSnapshot['remote'] = {
  remotes: [],
  hasRemotes: false,
  hasBrowserRemote: false,
  remoteProviders: {},
  hasGitHubRemote: false,
}

describe('independent repository reads', () => {
  test('reads the repository snapshot without also requesting pull requests', async () => {
    const snapshot: RepoSnapshot = { branches: [], current: 'main', remote: EMPTY_REMOTE }
    const getSnapshot = vi.fn(() => Promise.resolve(snapshot))
    const getPullRequests = vi.fn(() => Promise.resolve<PullRequestEntry[] | null>([]))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getSnapshot, getPullRequests }))),
    )
    const { readRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    await expect(readRepoSnapshot(WORKSPACE_ID)).resolves.toEqual({ snapshot })
    expect(getSnapshot).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(mocks.runWithRepoMembershipReadAdmission).toHaveBeenCalledWith({ id: 'test-boundary' }, expect.any(Function))
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  test('rejects rather than fabricating a snapshot when the source has none', async () => {
    const { readRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    await expect(readRepoSnapshot(WORKSPACE_ID)).rejects.toThrow('repository snapshot unavailable')
  })

  test('reads only the requested branch pull request', async () => {
    const pullRequests: PullRequestEntry[] = [
      {
        branch: 'feature/a',
        pullRequest: {
          number: 229,
          title: 'Converge repository authorities',
          url: 'https://example.invalid/repository/pull/229',
          state: 'open',
        },
      },
    ]
    const getSnapshot = vi.fn(() => Promise.resolve<RepoSnapshot | null>(null))
    const getPullRequests = vi.fn(() => Promise.resolve(pullRequests))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getSnapshot, getPullRequests }))),
    )
    const { readRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const scope = { kind: 'branch-detail' as const, branch: 'feature/a' }

    await expect(readRepoPullRequests(WORKSPACE_ID, scope)).resolves.toEqual({ pullRequests })
    expect(getPullRequests).toHaveBeenCalledWith(scope, { signal: expect.any(AbortSignal) })
    expect(getSnapshot).not.toHaveBeenCalled()
  })

  test('rejects a branch-detail response for a different branch', async () => {
    const getPullRequests = vi.fn(() =>
      Promise.resolve<PullRequestEntry[]>([
        {
          branch: 'feature/b',
          pullRequest: {
            number: 230,
            title: 'Wrong branch',
            url: 'https://example.invalid/repository/pull/230',
            state: 'open',
          },
        },
      ]),
    )
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getPullRequests }))),
    )
    const { readRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')

    await expect(readRepoPullRequests(WORKSPACE_ID, { kind: 'branch-detail', branch: 'feature/a' })).rejects.toThrow(
      'did not match requested branch',
    )
  })

  test('reads one complete runtime-scoped worktree status snapshot', async () => {
    const status: WorktreeStatus[] = [{ path: '/workspace', branch: 'main', isMain: true, entries: [] }]
    const getStatus = vi.fn(() => Promise.resolve(status))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getStatus }))),
    )
    const { readRepoWorktreeStatus } = await import('#/server/modules/repo-read-paths.ts')

    const result = await readRepoWorktreeStatus(WORKSPACE_ID, { workspaceRuntimeId: 'repo-runtime-test' })
    expect(result).toMatchObject({ workspaceRuntimeId: 'repo-runtime-test', status })
    expect(result.loadedAt).toEqual(expect.any(Number))
  })

  test('does not turn an aborted status read into an empty clean snapshot', async () => {
    const { readRepoWorktreeStatus } = await import('#/server/modules/repo-read-paths.ts')
    const controller = new AbortController()
    controller.abort()
    await expect(
      readRepoWorktreeStatus(WORKSPACE_ID, { workspaceRuntimeId: 'repo-runtime-test', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
  })

  test('reads operation activity from coordinator memory without probing Git', async () => {
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const result = await readRepoOperationsSnapshot(WORKSPACE_ID, {
      workspaceRuntimeId: 'repo-runtime-test',
      includeSettled: true,
    })

    expect(result).toMatchObject({ operations: [], lastFetchAt: null })
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
  })
})

describe('independent repository read deadlines', () => {
  test('rejects a snapshot read when its own deadline expires', async () => {
    useFakeTimers()
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getSnapshot: () => new Promise<RepoSnapshot | null>(() => {}),
          }),
        ),
      ),
    )
    const { readRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const rejected = expect(readRepoSnapshot(WORKSPACE_ID, { timeoutMs: 50 })).rejects.toThrow(
      'repository read timeout',
    )
    await vi.advanceTimersByTimeAsync(75)
    await rejected
  })

  test('rejects a pull-request read when an uncooperative source exceeds its own deadline', async () => {
    useFakeTimers()
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getPullRequests: () => new Promise<PullRequestEntry[] | null>(() => {}),
          }),
        ),
      ),
    )
    const { readRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const rejected = expect(
      readRepoPullRequests(WORKSPACE_ID, { kind: 'repository-summary' }, { timeoutMs: 50 }),
    ).rejects.toThrow('repository read timeout')
    await vi.advanceTimersByTimeAsync(75)
    await rejected
  })

  test('cancels a pull-request read when the caller aborts', async () => {
    let observedSignal: AbortSignal | undefined
    const started = Promise.withResolvers<void>()
    const getPullRequests: ReadSource['getPullRequests'] = (_scope, options) => {
      observedSignal = options?.signal
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        started.resolve()
      })
    }
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getPullRequests }))),
    )
    const { readRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const controller = new AbortController()
    const rejected = expect(
      readRepoPullRequests(WORKSPACE_ID, { kind: 'repository-summary' }, { signal: controller.signal }),
    ).rejects.toThrow('aborted')
    await started.promise
    controller.abort()
    await rejected
    expect(observedSignal?.aborted).toBe(true)
  })
})
