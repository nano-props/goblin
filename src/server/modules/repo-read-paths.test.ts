import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoBackend } from '#/server/modules/repo-backend.ts'
import type { ProbeResult, PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import type { LogEntry, WorktreeStatus } from '#/shared/git-types.ts'

const mocks = vi.hoisted(() => ({
  runWithRepoBackend: vi.fn(),
}))

vi.mock('#/server/modules/repo-backend.ts', () => ({
  runWithRepoBackend: mocks.runWithRepoBackend,
}))

// Tests only need the read surface; cast to the full interface at the
// boundary so individual stub objects stay focused.
type BackendTask = (backend: RepoBackend) => Promise<unknown>
function asRepoBackend(backend: ReadBackend): RepoBackend {
  return backend as unknown as RepoBackend
}

type ReadBackend = Pick<
  RepoBackend,
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

function makeBackend(overrides: Partial<ReadBackend> = {}): ReadBackend {
  const base: ReadBackend = {
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
  mocks.runWithRepoBackend.mockReset()
  mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) => task(asRepoBackend(makeBackend())))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getRepositoryLog', () => {
  test('reads branch history through the repo backend', async () => {
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
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(asRepoBackend(makeBackend({ getLog }))),
    )
    const { getRepositoryLog } = await import('#/server/modules/repo-read-paths.ts')
    const signal = new AbortController().signal

    await expect(getRepositoryLog('/tmp/repo', 'feature/work', { count: 30, skip: 0, signal })).resolves.toEqual(
      entries,
    )
    expect(getLog).toHaveBeenCalledWith('feature/work', { count: 30, skip: 0, signal })
  })

  test('uses the shared default branch history count', async () => {
    const getLog = vi.fn(() => Promise.resolve<LogEntry[]>([]))
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(asRepoBackend(makeBackend({ getLog }))),
    )
    const { getRepositoryLog } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepositoryLog('/tmp/repo', 'feature/work')).resolves.toEqual([])
    expect(getLog).toHaveBeenCalledWith('feature/work', { count: 50, skip: 0, signal: undefined })
  })
})

describe('getRepositoryWorktreeBootstrapPreview', () => {
  test('reads bootstrap preview through the repo backend', async () => {
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
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(asRepoBackend(makeBackend({ getWorktreeBootstrapPreview }))),
    )
    const { getRepositoryWorktreeBootstrapPreview } = await import('#/server/modules/repo-read-paths.ts')
    const signal = new AbortController().signal

    await expect(getRepositoryWorktreeBootstrapPreview('/tmp/repo', signal)).resolves.toMatchObject({
      ok: true,
      preview: { hasOperations: true },
    })
    expect(getWorktreeBootstrapPreview).toHaveBeenCalledWith(signal)
  })
})

describe('getRepositoryComposite timeout', () => {
  test('returns successful results when sections finish before the deadline', async () => {
    const snapshot: RepoSnapshot = {
      branches: [],
      current: 'main',
    }
    const status: WorktreeStatus[] = []
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(
        asRepoBackend(
          makeBackend({
            getSnapshot: () => Promise.resolve(snapshot),
            getStatus: () => Promise.resolve(status),
            getPullRequests: () => Promise.resolve(null),
          }),
        ),
      ),
    )
    const { getRepositoryComposite } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepositoryComposite('/tmp/repo', ['snapshot', 'status', 'pullRequests'], {
      timeoutMs: 5_000,
    })
    expect(result).toEqual({ snapshot, status, pullRequests: null })
  })

  test('falls back to the per-section default when a section times out', async () => {
    vi.useFakeTimers()
    // Snapshot returns immediately; status hangs until aborted; PRs
    // returns null after a short delay.
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(
        asRepoBackend(
          makeBackend({
            getSnapshot: () =>
              Promise.resolve<RepoSnapshot | null>({
                branches: [],
                current: 'main',
              }),
            getStatus: (_signal?: AbortSignal) =>
              new Promise<WorktreeStatus[]>((_resolve, reject) => {
                _signal?.addEventListener('abort', () => reject(new Error('aborted')))
              }),
            getPullRequests: () => Promise.resolve<PullRequestEntry[] | null>(null),
          }),
        ),
      ),
    )
    const { getRepositoryComposite } = await import('#/server/modules/repo-read-paths.ts')
    const promise = getRepositoryComposite('/tmp/repo', ['snapshot', 'status', 'pullRequests'], {
      timeoutMs: 50,
    })
    // Advance the fake clock past the section deadline so the status
    // signal aborts and its promise rejects.
    await vi.advanceTimersByTimeAsync(75)
    const result = await promise
    expect(result.snapshot).not.toBeNull()
    expect(result.status).toEqual([])
    expect(result.pullRequests).toBeNull()
  })

  test('disables the per-section timeout when timeoutMs is 0', async () => {
    let observedSignal: AbortSignal | undefined
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(
        asRepoBackend(
          makeBackend({
            getStatus: (signal?: AbortSignal) => {
              observedSignal = signal
              return new Promise<WorktreeStatus[]>((resolve) => {
                signal?.addEventListener('abort', () => resolve([]))
              })
            },
          }),
        ),
      ),
    )
    const { getRepositoryComposite } = await import('#/server/modules/repo-read-paths.ts')
    const promise = getRepositoryComposite('/tmp/repo', ['status'], { timeoutMs: 0 })
    // Give the microtask queue a chance to wire up.
    await Promise.resolve()
    // A fresh, never-aborting signal is still wired through to the
    // backend (so the backend code path is uniform) — just one
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
    let statusSignal: AbortSignal | undefined
    let prsSignal: AbortSignal | undefined
    mocks.runWithRepoBackend.mockImplementation((_cwd: string, task: BackendTask) =>
      task(
        asRepoBackend(
          makeBackend({
            getSnapshot: (signal?: AbortSignal) => {
              snapshotSignal = signal
              return new Promise<RepoSnapshot | null>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new Error('aborted')))
              })
            },
            getStatus: (signal?: AbortSignal) => {
              statusSignal = signal
              return new Promise<WorktreeStatus[]>((_resolve, reject) => {
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
    const { getRepositoryComposite } = await import('#/server/modules/repo-read-paths.ts')
    const controller = new AbortController()
    const promise = getRepositoryComposite('/tmp/repo', ['snapshot', 'status', 'pullRequests'], {
      signal: controller.signal,
    })
    // Let the section promises wire up their abort listeners.
    await Promise.resolve()
    controller.abort()
    const result = await promise
    expect(result).toEqual({ snapshot: null, status: [], pullRequests: null })
    expect(snapshotSignal?.aborted).toBe(true)
    expect(statusSignal?.aborted).toBe(true)
    expect(prsSignal?.aborted).toBe(true)
  })
})
