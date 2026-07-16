import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoSource } from '#/server/modules/repo-source.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import type { LogEntry, WorktreeStatus } from '#/shared/git-types.ts'

const mocks = vi.hoisted(() => ({
  runWithRepoSource: vi.fn(),
  listRepoWriteOperationsForRepo: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  runWithRepoSource: mocks.runWithRepoSource,
}))
vi.mock('#/server/modules/repo-write-operation-coordinator.ts', () => ({
  listRepoWriteOperationsForRepo: mocks.listRepoWriteOperationsForRepo,
}))

// Tests only need the read surface; cast to the full interface at the
// boundary so individual stub objects stay focused.
type SourceTask = (source: RepoSource) => Promise<unknown>
function asRepoSource(source: ReadSource): RepoSource {
  return source as unknown as RepoSource
}

type ReadSource = Pick<
  RepoSource,
  | 'id'
  | 'kind'
  | 'probe'
  | 'getSnapshot'
  | 'getStatus'
  | 'getPullRequests'
  | 'getLog'
  | 'fetch'
  | 'getWorktreeBootstrapPreview'
>

function makeSource(overrides: Partial<ReadSource> = {}): ReadSource {
  const base: ReadSource = {
    id: '/tmp/repo',
    kind: 'local',
    probe: () => Promise.resolve({ ok: true }),
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
  mocks.runWithRepoSource.mockReset()
  mocks.listRepoWriteOperationsForRepo.mockReset()
  mocks.listRepoWriteOperationsForRepo.mockResolvedValue([])
  mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) => task(asRepoSource(makeSource())))
})

afterEach(() => {
  vi.useRealTimers()
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

    await expect(getRepoLog('/tmp/repo', 'feature/work', { count: 30, skip: 0, signal })).resolves.toEqual(entries)
    expect(getLog).toHaveBeenCalledWith('feature/work', { count: 30, skip: 0, signal })
  })

  test('uses the shared default branch history count', async () => {
    const getLog = vi.fn(() => Promise.resolve<LogEntry[]>([]))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getLog }))),
    )
    const { getRepoLog } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepoLog('/tmp/repo', 'feature/work')).resolves.toEqual([])
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

    await expect(getRepoWorktreeBootstrapPreview('goblin+file:///tmp/repo', { signal })).resolves.toMatchObject({
      ok: true,
      preview: { hasOperations: true },
    })
    expect(getWorktreeBootstrapPreview).toHaveBeenCalledWith(signal)
  })
})

describe('readRepoProjection', () => {
  test('reads snapshot and current-branch pull requests through one server projection', async () => {
    const snapshot: RepoSnapshot = {
      branches: [],
      current: 'main',
    }
    const pullRequests: PullRequestEntry[] = [
      {
        branch: 'feature/a',
        pullRequest: {
          number: 229,
          title: 'Converge repo data authority',
          url: 'https://github.com/acme/repo/pull/229',
          state: 'open',
        },
      },
    ]
    const getSnapshot = vi.fn(() => Promise.resolve(snapshot))
    const getStatus = vi.fn(() => Promise.resolve<WorktreeStatus[]>([]))
    const getPullRequests = vi.fn(() => Promise.resolve(pullRequests))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getSnapshot, getStatus, getPullRequests }))),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')
    const signal = new AbortController().signal

    const result = await readRepoProjection('/tmp/repo', { branch: 'feature/a', mode: 'full', signal })

    expect(result).toMatchObject({
      snapshot,
      pullRequests,
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
    })
    expect(result.loadedAt).toEqual(expect.any(Number))
    expect(getSnapshot).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(getStatus).not.toHaveBeenCalled()
    expect(getPullRequests).toHaveBeenCalledWith(['feature/a'], {
      mode: 'full',
      signal: expect.any(AbortSignal),
    })
    expect(mocks.listRepoWriteOperationsForRepo).toHaveBeenCalledWith('/tmp/repo', {
      signal,
      repoRuntimeId: undefined,
    })
  })

  test('scopes embedded operations to the requested repo runtime', async () => {
    mocks.listRepoWriteOperationsForRepo.mockResolvedValue([
      {
        id: 'op-current',
        repoId: '/tmp/repo',
        repoRuntimeId: 'repo-runtime-current',
        kind: 'fetch',
        source: 'background',
        phase: 'running',
        enqueuedAt: 1,
        startedAt: 2,
        settledAt: null,
        error: null,
      },
    ])
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')
    const signal = new AbortController().signal

    const result = await readRepoProjection('/tmp/repo', { signal, repoRuntimeId: 'repo-runtime-current' })

    expect(result.operations.operations).toMatchObject([{ id: 'op-current', repoRuntimeId: 'repo-runtime-current' }])
    expect(mocks.listRepoWriteOperationsForRepo).toHaveBeenCalledWith('/tmp/repo', {
      signal,
      repoRuntimeId: 'repo-runtime-current',
    })
  })

  test('does not read all pull requests when no branch is requested', async () => {
    const getPullRequests = vi.fn(() => Promise.resolve<PullRequestEntry[] | null>([]))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getPullRequests }))),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')

    const result = await readRepoProjection('/tmp/repo')

    expect(result).toMatchObject({
      snapshot: null,
      pullRequests: null,
      requested: { branch: null, pullRequestMode: 'full' },
    })
    expect(getPullRequests).not.toHaveBeenCalled()
  })

  test('reads one complete repo-runtime-scoped worktree status snapshot', async () => {
    const status: WorktreeStatus[] = [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }]
    const getStatus = vi.fn(() => Promise.resolve(status))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getStatus }))),
    )
    const { readRepoWorktreeStatus } = await import('#/server/modules/repo-read-paths.ts')

    const result = await readRepoWorktreeStatus('/tmp/repo', { repoRuntimeId: 'repo-runtime-test' })

    expect(result).toMatchObject({ repoRuntimeId: 'repo-runtime-test', status })
    expect(result.loadedAt).toEqual(expect.any(Number))
    expect(getStatus).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  test('does not turn an aborted status read into an empty clean snapshot', async () => {
    const { readRepoWorktreeStatus } = await import('#/server/modules/repo-read-paths.ts')
    const controller = new AbortController()
    controller.abort()

    await expect(
      readRepoWorktreeStatus('/tmp/repo', { repoRuntimeId: 'repo-runtime-test', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
  })

  test('reads all pull request summaries when the dashboard projection asks for summary mode', async () => {
    const pullRequests: PullRequestEntry[] = [
      {
        branch: 'feature/a',
        pullRequest: {
          number: 230,
          title: 'Dashboard summary projection',
          url: 'https://github.com/acme/repo/pull/230',
          state: 'open',
        },
      },
    ]
    const getPullRequests = vi.fn(() => Promise.resolve<PullRequestEntry[] | null>(pullRequests))
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(asRepoSource(makeSource({ getPullRequests }))),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')

    const result = await readRepoProjection('/tmp/repo', { mode: 'summary' })

    expect(result).toMatchObject({
      pullRequests,
      requested: { branch: null, pullRequestMode: 'summary' },
    })
    expect(getPullRequests).toHaveBeenCalledWith(undefined, {
      mode: 'summary',
      signal: expect.any(AbortSignal),
    })
  })
})

describe('repo projection section deadlines', () => {
  test('rejects a worktree status snapshot when its status read times out', async () => {
    vi.useFakeTimers()
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getStatus: (signal?: AbortSignal) =>
              new Promise<WorktreeStatus[]>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(signal.reason))
              }),
          }),
        ),
      ),
    )
    const { readRepoWorktreeStatus } = await import('#/server/modules/repo-read-paths.ts')
    const promise = readRepoWorktreeStatus('/tmp/repo', {
      repoRuntimeId: 'repo-runtime-test',
      timeoutMs: 50,
    })

    const rejected = expect(promise).rejects.toThrow('repository read timeout')
    await vi.advanceTimersByTimeAsync(75)
    await rejected
  })

  test('does not accept an empty status result resolved after its deadline', async () => {
    vi.useFakeTimers()
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getStatus: (signal?: AbortSignal) =>
              new Promise<WorktreeStatus[]>((resolve) => {
                signal?.addEventListener('abort', () => resolve([]))
              }),
          }),
        ),
      ),
    )
    const { readRepoWorktreeStatus } = await import('#/server/modules/repo-read-paths.ts')
    const promise = readRepoWorktreeStatus('/tmp/repo', {
      repoRuntimeId: 'repo-runtime-test',
      timeoutMs: 50,
    })

    const rejected = expect(promise).rejects.toThrow('repository read timeout')
    await vi.advanceTimersByTimeAsync(75)
    await rejected
  })

  test('returns successful results when sections finish before the deadline', async () => {
    const snapshot: RepoSnapshot = {
      branches: [],
      current: 'main',
    }
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getSnapshot: () => Promise.resolve(snapshot),
            getPullRequests: () => Promise.resolve(null),
          }),
        ),
      ),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')
    const result = await readRepoProjection('/tmp/repo', { branch: 'feature/a', timeoutMs: 5_000 })
    expect(result).toMatchObject({ snapshot, pullRequests: null })
  })

  test('rejects when a requested section times out', async () => {
    vi.useFakeTimers()
    // Snapshot hangs until aborted; PRs returns immediately.
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getSnapshot: (signal?: AbortSignal) =>
              new Promise<RepoSnapshot | null>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new Error('aborted')))
              }),
            getPullRequests: () => Promise.resolve<PullRequestEntry[] | null>(null),
          }),
        ),
      ),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')
    const promise = readRepoProjection('/tmp/repo', { branch: 'feature/a', timeoutMs: 50 })
    const rejected = expect(promise).rejects.toThrow('aborted')
    // Advance the fake clock past the section deadline.
    await vi.advanceTimersByTimeAsync(75)
    await rejected
  })

  test('disables the per-section timeout when timeoutMs is 0', async () => {
    let observedSignal: AbortSignal | undefined
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getSnapshot: (signal?: AbortSignal) => {
              observedSignal = signal
              return new Promise<RepoSnapshot | null>((resolve) => {
                signal?.addEventListener('abort', () => resolve(null))
              })
            },
          }),
        ),
      ),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')
    const promise = readRepoProjection('/tmp/repo', { timeoutMs: 0 })
    // Give the microtask queue a chance to wire up.
    await Promise.resolve()
    // A fresh, never-aborting signal is still wired through to the
    // source (so the source code path is uniform) — just one
    // that will never fire on its own.
    expect(observedSignal).toBeDefined()
    expect(observedSignal?.aborted).toBe(false)
    // No assertion can wait "forever" — race against a 100ms timeout
    // to make sure the promise never resolves on its own.
    const result = await Promise.race([
      promise,
      new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 100)),
    ])
    expect(result).toBe('still-pending')
  })

  test('cancels every section when the caller signal fires', async () => {
    let snapshotSignal: AbortSignal | undefined
    let prsSignal: AbortSignal | undefined
    mocks.runWithRepoSource.mockImplementation((_cwd: string, task: SourceTask) =>
      task(
        asRepoSource(
          makeSource({
            getSnapshot: (signal?: AbortSignal) => {
              snapshotSignal = signal
              return new Promise<RepoSnapshot | null>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new Error('aborted')))
              })
            },
            getPullRequests: (_branches?: string[], options?: { signal?: AbortSignal }) => {
              prsSignal = options?.signal
              return new Promise<PullRequestEntry[] | null>((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
              })
            },
          }),
        ),
      ),
    )
    const { readRepoProjection } = await import('#/server/modules/repo-read-paths.ts')
    const controller = new AbortController()
    const promise = readRepoProjection('/tmp/repo', {
      branch: 'feature/a',
      signal: controller.signal,
    })
    const rejected = expect(promise).rejects.toThrow('aborted')
    // Let the section promises wire up their abort listeners.
    await Promise.resolve()
    controller.abort()
    await rejected
    expect(snapshotSignal?.aborted).toBe(true)
    expect(prsSignal?.aborted).toBe(true)
  })
})
