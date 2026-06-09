import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortBackgroundServerNetworkOp: vi.fn(),
  fetchRepository: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  subscribeServerFetchInterval: vi.fn(),
}))

vi.mock('#/server/common/network-ops.ts', () => ({
  abortBackgroundServerNetworkOp: mocks.abortBackgroundServerNetworkOp,
}))

vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  fetchRepository: mocks.fetchRepository,
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
    mocks.fetchRepository.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a', '/tmp/repo-b'])
    await vi.runOnlyPendingTimersAsync()

    expect(mocks.fetchRepository).toHaveBeenNthCalledWith(1, '/tmp/repo-a', 'background')
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenNthCalledWith(2, '/tmp/repo-b', 'background')

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepository).toHaveBeenNthCalledWith(3, '/tmp/repo-a', 'background')
  })

  test('stops scheduling when the repo set is cleared', async () => {
    mocks.fetchRepository.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo'])
    await vi.runOnlyPendingTimersAsync()
    await setBackgroundSyncRepos([])
    await vi.advanceTimersByTimeAsync(10000)

    expect(mocks.fetchRepository).toHaveBeenCalledTimes(1)
  })

  test('aborts in-flight background fetches for repos removed from the active set', async () => {
    mocks.fetchRepository.mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await setBackgroundSyncRepos(['/tmp/repo-b'])

    expect(mocks.abortBackgroundServerNetworkOp).toHaveBeenCalledWith('/tmp/repo-a')
  })

  test('only re-fetches a repo on re-activation once its previous fetch is overdue', async () => {
    mocks.fetchRepository.mockResolvedValue({ ok: true, message: 'ok' })
    const { getBackgroundSyncDiagnostics, setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenNthCalledWith(1, '/tmp/repo-a', 'background')

    await vi.advanceTimersByTimeAsync(1000)
    await setBackgroundSyncRepos(['/tmp/repo-b'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenNthCalledWith(2, '/tmp/repo-b', 'background')

    await vi.advanceTimersByTimeAsync(1000)
    await setBackgroundSyncRepos(['/tmp/repo-a'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(2)

    const now = Date.now()
    const repoA = getBackgroundSyncDiagnostics(now).repos.find((repo) => repo.repoId === '/tmp/repo-a')
    expect(repoA?.lastFetchAt).not.toBeNull()
    expect(repoA?.nextEligibleAt).toBeGreaterThan(now)
    const remainingUntilDue = (repoA?.nextEligibleAt ?? now) - now

    await vi.advanceTimersByTimeAsync(Math.max(remainingUntilDue - 1, 0))
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.fetchRepository).toHaveBeenNthCalledWith(3, '/tmp/repo-a', 'background')
  })

  test('re-schedules when the server fetch interval changes', async () => {
    let onChange: ((sec: number) => void) | undefined
    mocks.fetchRepository.mockResolvedValue({ ok: true, message: 'ok' })
    mocks.subscribeServerFetchInterval.mockImplementation((listener: (sec: number) => void) => {
      onChange = listener
      return () => {}
    })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(1)

    onChange?.(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(1)

    onChange?.(5)
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(2)
  })

  test('backs off retries after a fetch failure and resumes normal cadence after success', async () => {
    mocks.fetchRepository
      .mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })
      .mockResolvedValueOnce({ ok: true, message: 'ok' })
      .mockResolvedValue({ ok: true, message: 'ok' })
    const { setBackgroundSyncRepos } = await import('#/server/modules/background-sync.ts')

    await setBackgroundSyncRepos(['/tmp/repo'])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepository).toHaveBeenCalledTimes(3)
  })

  test('reports diagnostics for registered repos', async () => {
    mocks.fetchRepository.mockResolvedValue({ ok: true, message: 'ok' })
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
