import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortRepoBackgroundOperation: vi.fn(),
  fetchRepo: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  subscribeServerFetchInterval: vi.fn(),
}))

vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  abortRepoBackgroundOperation: mocks.abortRepoBackgroundOperation,
  fetchRepo: mocks.fetchRepo,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
  subscribeServerFetchInterval: mocks.subscribeServerFetchInterval,
}))

describe('server background sync scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.getServerFetchIntervalSec.mockResolvedValue(5)
    mocks.subscribeServerFetchInterval.mockImplementation(() => () => {})
  })

  afterEach(async () => {
    const { resetBackgroundSyncForTests } = await import('#/server/modules/background-sync.ts')
    resetBackgroundSyncForTests()
    vi.useRealTimers()
    vi.resetModules()
  })

  test('runs immediate background fetches for registered repos and repeats by interval', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a', '/tmp/repo-b'])
    await vi.runOnlyPendingTimersAsync()

    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(1, '/tmp/repo-a', 'background')
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(2, '/tmp/repo-b', 'background')

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(3, '/tmp/repo-a', 'background')
  })

  test('stops scheduling when the repo set is cleared', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo'])
    await vi.runOnlyPendingTimersAsync()
    await setBackgroundSyncRepos([])
    await vi.advanceTimersByTimeAsync(10000)

    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)
  })

  test('aborts in-flight background fetches for repos removed from the active set', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await setBackgroundSyncRepos(['/tmp/repo-b'])

    expect(mocks.abortRepoBackgroundOperation).toHaveBeenCalledWith('/tmp/repo-a')
  })

  test('only re-fetches a repo on re-activation once its previous fetch is overdue', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { getBackgroundSyncDiagnostics, setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(1, '/tmp/repo-a', 'background')

    await vi.advanceTimersByTimeAsync(1000)
    await setBackgroundSyncRepos(['/tmp/repo-b'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(2, '/tmp/repo-b', 'background')

    await vi.advanceTimersByTimeAsync(1000)
    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await Promise.resolve()
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)

    const now = Date.now()
    const repoA = getBackgroundSyncDiagnostics(now).repos.find((repo) => repo.repoId === '/tmp/repo-a')
    expect(repoA?.lastFetchAt).not.toBeNull()
    expect(repoA?.nextEligibleAt).toBeGreaterThan(now)
    const remainingUntilDue = (repoA?.nextEligibleAt ?? now) - now

    await vi.advanceTimersByTimeAsync(Math.max(remainingUntilDue - 1, 0))
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(3, '/tmp/repo-a', 'background')
  })

  test('re-schedules when the server fetch interval changes', async () => {
    let onChange: ((sec: number) => void) | undefined
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    mocks.subscribeServerFetchInterval.mockImplementation((listener: (sec: number) => void) => {
      onChange = listener
      return () => {}
    })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)

    onChange?.(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)

    onChange?.(5)
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)
  })

  test('does not abort or re-fetch when re-registering the same repo set', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await vi.runOnlyPendingTimersAsync()
    const callsAfterFirst = mocks.fetchRepo.mock.calls.length

    // Re-registering the same set must not abort the in-flight task or
    // re-trigger an immediate fetch — the interval hasn't elapsed.
    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.fetchRepo.mock.calls.length).toBe(callsAfterFirst)
    expect(mocks.abortRepoBackgroundOperation).not.toHaveBeenCalled()
  })

  test("re-enqueues a tab-switched repo from the previous fetch's finally", async () => {
    let resolveFetchA: (value: { ok: boolean; message: string }) => void = () => {}
    const fetchAStarted = vi.fn()
    mocks.fetchRepo.mockImplementation(async (repoId: string) => {
      if (repoId === '/repo-a') {
        fetchAStarted()
        return await new Promise<{ ok: boolean; message: string }>((resolve) => {
          resolveFetchA = resolve
        })
      }
      return { ok: true, message: 'ok' }
    })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/repo-a'])
    await vi.runOnlyPendingTimersAsync()
    expect(fetchAStarted).toHaveBeenCalledTimes(1)

    // While A is in flight, the user switches to B. The immediate enqueue for B
    // is skipped because the queue is busy, but the `finally` on A's task must
    // re-enqueue as soon as A settles — without waiting for the next cron tick.
    await setBackgroundSyncRepos(['/repo-b'])
    expect(mocks.fetchRepo.mock.calls.some((c) => c[0] === '/repo-b')).toBe(false)

    resolveFetchA({ ok: true, message: 'ok' })
    // waitFor polls microtasks; using advanceTimersByTime would risk letting
    // the per-second cron catch B for us and mask a broken `finally` re-enqueue.
    await vi.waitFor(() => expect(mocks.fetchRepo).toHaveBeenCalledWith('/repo-b', 'background'))

    const bCalls = mocks.fetchRepo.mock.calls.filter((c) => c[0] === '/repo-b' && c[1] === 'background')
    expect(bCalls.length).toBe(1)
  })

  test('backs off retries after a fetch failure and resumes normal cadence after success', async () => {
    mocks.fetchRepo
      .mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })
      .mockResolvedValueOnce({ ok: true, message: 'ok' })
      .mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(3)
  })

  test('reports diagnostics for registered repos', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { getBackgroundSyncDiagnostics, setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await vi.runOnlyPendingTimersAsync()

    expect(getBackgroundSyncDiagnostics(10_000)).toMatchObject({
      running: true,
      intervalSec: 5, // This is the fetch interval, not the check interval
      repoIds: ['/tmp/repo-a'],
      repos: [
        {
          repoId: '/tmp/repo-a',
          lastFetchAt: expect.any(Number),
          failureCount: 0,
          backoffUntil: null,
          nextEligibleAt: expect.any(Number),
        },
      ],
    })
  })
})
