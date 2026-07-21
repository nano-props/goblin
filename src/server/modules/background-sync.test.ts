import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { BackgroundSyncRegistrationAdmission } from '#/server/modules/background-sync.ts'

const REPO = workspaceIdForTest('goblin+file:///workspace')
const REPO_A = workspaceIdForTest('goblin+file:///workspace-a')
const REPO_B = workspaceIdForTest('goblin+file:///workspace-b')
const REPO_C = workspaceIdForTest('goblin+file:///workspace-c')
const USER_ID = 'background-sync-user'
const CLIENT_ID = 'client_background_sync_test'
const RUNTIME_ID = 'workspace-runtime-background-sync-test'
let nextRegistrationRevision = 1

function requiredAdmission(
  admission: BackgroundSyncRegistrationAdmission | null,
): BackgroundSyncRegistrationAdmission {
  if (!admission) throw new Error('expected background sync admission')
  return admission
}

async function registerRepos(workspaceIds: WorkspaceId[]): Promise<void> {
  const { beginBackgroundSyncRegistration, commitBackgroundSyncRegistration, prepareBackgroundSync } = await import(
    '#/server/modules/background-sync.ts'
  )
  await prepareBackgroundSync()
  const targets = workspaceIds.map((workspaceId) => ({ workspaceId, workspaceRuntimeId: RUNTIME_ID }))
  const admission = requiredAdmission(
    beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, nextRegistrationRevision++, targets),
  )
  commitBackgroundSyncRegistration(admission)
}

const mocks = vi.hoisted(() => ({
  fetchRepo: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  subscribeServerFetchInterval: vi.fn(),
}))

vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  fetchRepo: mocks.fetchRepo,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
  subscribeServerFetchInterval: mocks.subscribeServerFetchInterval,
}))

describe('server background sync scheduler', () => {
  beforeEach(() => {
    nextRegistrationRevision = 1
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
    await registerRepos([REPO_A, REPO_B])
    await vi.runOnlyPendingTimersAsync()

    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(1, REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(2, REPO_B, 'background', expect.any(AbortSignal), RUNTIME_ID)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(3, REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)
  })

  test('drains all initially due repos without waiting for repeated cron ticks', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    await registerRepos([REPO_A, REPO_B, REPO_C])
    await vi.runOnlyPendingTimersAsync()

    await vi.waitFor(() => expect(mocks.fetchRepo).toHaveBeenCalledTimes(3))
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(1, REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(2, REPO_B, 'background', expect.any(AbortSignal), RUNTIME_ID)
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(3, REPO_C, 'background', expect.any(AbortSignal), RUNTIME_ID)
  })

  test('stops scheduling when the repo set is cleared', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    await registerRepos([REPO])
    await vi.runOnlyPendingTimersAsync()
    await registerRepos([])
    await vi.advanceTimersByTimeAsync(10000)

    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)
  })

  test('aborts in-flight background fetches for repos removed from the active set', async () => {
    let repoASignal: AbortSignal | undefined
    mocks.fetchRepo.mockImplementation(async (repoId: string, _kind: string, signal?: AbortSignal) => {
      if (repoId === REPO_A) {
        repoASignal = signal
        return await new Promise<{ ok: boolean; message: string }>((resolve) => {
          signal?.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }), { once: true })
        })
      }
      return { ok: true, message: 'ok' }
    })
    await registerRepos([REPO_A])
    await vi.waitFor(() => expect(repoASignal).toBeDefined())
    expect(repoASignal?.aborted).toBe(false)
    await registerRepos([REPO_B])

    expect(repoASignal?.aborted).toBe(true)
  })

  test('does not treat a removed in-flight background fetch as a completed cadence attempt', async () => {
    let repoASignal: AbortSignal | undefined
    mocks.fetchRepo.mockImplementation(async (repoId: string, _kind: string, signal?: AbortSignal) => {
      if (repoId === REPO_A && !repoASignal) {
        repoASignal = signal
        return await new Promise<{ ok: boolean; message: string }>((resolve) => {
          signal?.addEventListener('abort', () => resolve({ ok: false, message: 'cancelled' }), { once: true })
        })
      }
      return { ok: true, message: 'ok' }
    })
    await registerRepos([REPO_A])
    await vi.waitFor(() => expect(repoASignal).toBeDefined())
    await registerRepos([REPO_B])
    await vi.waitFor(() => {
      expect(mocks.fetchRepo).toHaveBeenCalledWith(REPO_B, 'background', expect.any(AbortSignal), RUNTIME_ID)
    })

    await registerRepos([REPO_A])
    await vi.waitFor(() => {
      const repoACalls = mocks.fetchRepo.mock.calls.filter((call) => call[0] === REPO_A)
      expect(repoACalls).toHaveLength(2)
    })
  })

  test('only re-fetches a repo on re-activation once its previous fetch is overdue', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { getBackgroundSyncDiagnostics } = await import('#/server/modules/background-sync.ts')

    await registerRepos([REPO_A])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(1, REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)

    await vi.advanceTimersByTimeAsync(1000)
    await registerRepos([REPO_B])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(2, REPO_B, 'background', expect.any(AbortSignal), RUNTIME_ID)

    await vi.advanceTimersByTimeAsync(1000)
    await registerRepos([REPO_A])
    await Promise.resolve()
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)

    const now = Date.now()
    const repoA = getBackgroundSyncDiagnostics(now).repos.find((repo) => repo.repoId === REPO_A)
    expect(repoA?.lastFetchStartedAt).not.toBeNull()
    expect(repoA?.nextEligibleAt).toBeGreaterThan(now)
    const remainingUntilDue = (repoA?.nextEligibleAt ?? now) - now

    await vi.advanceTimersByTimeAsync(Math.max(remainingUntilDue - 1, 0))
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.fetchRepo).toHaveBeenNthCalledWith(3, REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)
  })

  test('re-schedules when the server fetch interval changes', async () => {
    let onChange: ((sec: number) => void) | undefined
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    mocks.subscribeServerFetchInterval.mockImplementation((listener: (sec: number) => void) => {
      onChange = listener
      return () => {}
    })
    await registerRepos([REPO])
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
    await registerRepos([REPO_A])
    await vi.runOnlyPendingTimersAsync()
    const callsAfterFirst = mocks.fetchRepo.mock.calls.length

    // Re-registering the same set must not abort the in-flight task or
    // re-trigger an immediate fetch — the interval hasn't elapsed.
    await registerRepos([REPO_A])
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.fetchRepo.mock.calls.length).toBe(callsAfterFirst)
  })

  test("re-enqueues a tab-switched repo from the previous fetch's finally", async () => {
    let resolveFetchA: (value: { ok: boolean; message: string }) => void = () => {}
    const fetchAStarted = vi.fn()
    mocks.fetchRepo.mockImplementation(async (repoId: string) => {
      if (repoId === REPO_A) {
        fetchAStarted()
        return await new Promise<{ ok: boolean; message: string }>((resolve) => {
          resolveFetchA = resolve
        })
      }
      return { ok: true, message: 'ok' }
    })
    await registerRepos([REPO_A])
    await vi.runOnlyPendingTimersAsync()
    expect(fetchAStarted).toHaveBeenCalledTimes(1)

    // While A is in flight, the user switches to B. The immediate enqueue for B
    // is skipped because the queue is busy, but the `finally` on A's task must
    // re-enqueue as soon as A settles — without waiting for the next cron tick.
    await registerRepos([REPO_B])
    expect(mocks.fetchRepo.mock.calls.some((c) => c[0] === REPO_B)).toBe(false)

    resolveFetchA({ ok: true, message: 'ok' })
    // waitFor polls microtasks; using advanceTimersByTime would risk letting
    // the per-second cron catch B for us and mask a broken `finally` re-enqueue.
    await vi.waitFor(() =>
      expect(mocks.fetchRepo).toHaveBeenCalledWith(REPO_B, 'background', expect.any(AbortSignal), RUNTIME_ID),
    )

    const bCalls = mocks.fetchRepo.mock.calls.filter((c) => c[0] === REPO_B && c[1] === 'background')
    expect(bCalls.length).toBe(1)
  })

  test('coalesces repeated schedule ticks into one idle drain while a fetch is running', async () => {
    let resolveFetchA: (value: { ok: boolean; message: string }) => void = () => {}
    mocks.fetchRepo.mockImplementation(async (repoId: string) => {
      if (repoId === REPO_A) {
        return await new Promise<{ ok: boolean; message: string }>((resolve) => {
          resolveFetchA = resolve
        })
      }
      return { ok: true, message: 'ok' }
    })
    const { getBackgroundSyncDiagnostics } = await import('#/server/modules/background-sync.ts')

    await registerRepos([REPO_A])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenCalledWith(REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)

    await registerRepos([REPO_B])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(getBackgroundSyncDiagnostics().idleDrainScheduled).toBe(true)
    expect(mocks.fetchRepo.mock.calls.filter((call) => call[0] === REPO_B)).toHaveLength(0)

    resolveFetchA({ ok: true, message: 'ok' })
    await vi.waitFor(() =>
      expect(mocks.fetchRepo).toHaveBeenCalledWith(REPO_B, 'background', expect.any(AbortSignal), RUNTIME_ID),
    )
    expect(getBackgroundSyncDiagnostics().idleDrainScheduled).toBe(false)
    expect(mocks.fetchRepo.mock.calls.filter((call) => call[0] === REPO_B)).toHaveLength(1)
  })

  test('backs off retries after a fetch failure and resumes normal cadence after success', async () => {
    mocks.fetchRepo
      .mockResolvedValueOnce({ ok: false, message: 'fatal: offline' })
      .mockResolvedValueOnce({ ok: true, message: 'ok' })
      .mockResolvedValue({ ok: true, message: 'ok' })
    await registerRepos([REPO])
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(3)
  })

  test('backs off after repository boundary capture throws and keeps the scheduler healthy', async () => {
    mocks.fetchRepo
      .mockRejectedValueOnce(new Error('error.repository-boundary-unavailable'))
      .mockResolvedValue({ ok: true, message: 'ok' })
    const { getBackgroundSyncDiagnostics } = await import('#/server/modules/background-sync.ts')

    await registerRepos([REPO])
    await vi.runOnlyPendingTimersAsync()

    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)
    expect(getBackgroundSyncDiagnostics().repos).toEqual([
      expect.objectContaining({ repoId: REPO, failureCount: 1, backoffUntil: expect.any(Number) }),
    ])

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.fetchRepo).toHaveBeenCalledTimes(2)
    expect(getBackgroundSyncDiagnostics().repos).toEqual([
      expect.objectContaining({ repoId: REPO, failureCount: 0, backoffUntil: null }),
    ])
  })

  test('reports diagnostics for registered repos', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { getBackgroundSyncDiagnostics } = await import('#/server/modules/background-sync.ts')

    await registerRepos([REPO_A])
    await vi.runOnlyPendingTimersAsync()

    expect(getBackgroundSyncDiagnostics(10_000)).toMatchObject({
      running: true,
      intervalSec: 5, // This is the fetch interval, not the check interval
      repoIds: [REPO_A],
      repos: [
        {
          repoId: REPO_A,
          lastFetchStartedAt: expect.any(Number),
          failureCount: 0,
          backoffUntil: null,
          nextEligibleAt: expect.any(Number),
        },
      ],
    })
  })

  test('keeps registrations isolated by authenticated user', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const { beginBackgroundSyncRegistration, commitBackgroundSyncRegistration, getBackgroundSyncRepos } =
      await import('#/server/modules/background-sync.ts')
    const secondUserId = 'background-sync-user-b'
    const secondRuntimeId = 'workspace-runtime-background-sync-b'

    await registerRepos([REPO_A])
    const targets = [
      { workspaceId: REPO_B, workspaceRuntimeId: secondRuntimeId },
    ]
    const admission = requiredAdmission(
      beginBackgroundSyncRegistration(secondUserId, 'client_background_sync_second', 1, targets),
    )
    commitBackgroundSyncRegistration(admission)
    await vi.runOnlyPendingTimersAsync()
    await vi.waitFor(() => expect(mocks.fetchRepo).toHaveBeenCalledTimes(2))

    expect(getBackgroundSyncRepos(USER_ID)).toEqual([REPO_A])
    expect(getBackgroundSyncRepos(secondUserId)).toEqual([REPO_B])
    expect(mocks.fetchRepo).toHaveBeenCalledWith(REPO_A, 'background', expect.any(AbortSignal), RUNTIME_ID)
    expect(mocks.fetchRepo).toHaveBeenCalledWith(REPO_B, 'background', expect.any(AbortSignal), secondRuntimeId)
  })

  test('unions client-owned registrations and executes a shared runtime target once', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const {
      beginBackgroundSyncRegistration,
      commitBackgroundSyncRegistration,
      getBackgroundSyncRepos,
      prepareBackgroundSync,
    } = await import('#/server/modules/background-sync.ts')
    await prepareBackgroundSync()

    const firstClient = 'client_background_sync_first'
    const secondClient = 'client_background_sync_second'
    const firstTargets = [
      { workspaceId: REPO_A, workspaceRuntimeId: RUNTIME_ID },
    ]
    const firstAdmission = requiredAdmission(beginBackgroundSyncRegistration(USER_ID, firstClient, 1, firstTargets))
    commitBackgroundSyncRegistration(firstAdmission)
    const secondTargets = [
      { workspaceId: REPO_A, workspaceRuntimeId: RUNTIME_ID },
      { workspaceId: REPO_B, workspaceRuntimeId: RUNTIME_ID },
    ]
    const secondAdmission = requiredAdmission(beginBackgroundSyncRegistration(USER_ID, secondClient, 1, secondTargets))
    commitBackgroundSyncRegistration(secondAdmission)

    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(getBackgroundSyncRepos(USER_ID)).toEqual([REPO_A, REPO_B])
    expect(mocks.fetchRepo.mock.calls.filter((call) => call[0] === REPO_A)).toHaveLength(1)
    expect(mocks.fetchRepo.mock.calls.filter((call) => call[0] === REPO_B)).toHaveLength(1)
  })

  test('rejects an older registration commit after a newer request begins', async () => {
    const {
      beginBackgroundSyncRegistration,
      commitBackgroundSyncRegistration,
      getBackgroundSyncRepos,
      prepareBackgroundSync,
    } = await import('#/server/modules/background-sync.ts')
    await prepareBackgroundSync()

    const olderAdmission = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, 1, [
        { workspaceId: REPO_A, workspaceRuntimeId: RUNTIME_ID },
      ]),
    )
    const newerAdmission = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, 2, [
        { workspaceId: REPO_B, workspaceRuntimeId: RUNTIME_ID },
      ]),
    )
    expect(olderAdmission.signal.aborted).toBe(true)
    expect(commitBackgroundSyncRegistration(newerAdmission)).toBe(true)
    expect(commitBackgroundSyncRegistration(olderAdmission)).toBe(false)

    expect(getBackgroundSyncRepos(USER_ID)).toEqual([REPO_B])
  })

  test('rejects an older client revision that arrives after the latest request', async () => {
    const {
      beginBackgroundSyncRegistration,
      commitBackgroundSyncRegistration,
      getBackgroundSyncRepos,
      prepareBackgroundSync,
    } = await import('#/server/modules/background-sync.ts')
    await prepareBackgroundSync()

    const latestAdmission = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, 2, [
        { workspaceId: REPO_B, workspaceRuntimeId: RUNTIME_ID },
      ]),
    )
    expect(
      beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, 1, [
        { workspaceId: REPO_A, workspaceRuntimeId: RUNTIME_ID },
      ]),
    ).toBeNull()
    expect(latestAdmission.signal.aborted).toBe(false)
    expect(commitBackgroundSyncRegistration(latestAdmission)).toBe(true)
    expect(getBackgroundSyncRepos(USER_ID)).toEqual([REPO_B])
  })

  test('accepts a fresh revision sequence for a different page owner', async () => {
    const {
      beginBackgroundSyncRegistration,
      commitBackgroundSyncRegistration,
      getBackgroundSyncRepos,
      prepareBackgroundSync,
    } = await import('#/server/modules/background-sync.ts')
    await prepareBackgroundSync()

    const firstPage = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, CLIENT_ID, 2, [
        { workspaceId: REPO_A, workspaceRuntimeId: RUNTIME_ID },
      ]),
    )
    const newPage = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, 'background-sync-new-page', 1, [
        { workspaceId: REPO_B, workspaceRuntimeId: RUNTIME_ID },
      ]),
    )

    expect(commitBackgroundSyncRegistration(firstPage)).toBe(true)
    expect(commitBackgroundSyncRegistration(newPage)).toBe(true)
    expect(getBackgroundSyncRepos(USER_ID)).toEqual([REPO_A, REPO_B])
  })

  test('removes a registration when its authoritative Workspace runtime closes', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const {
      beginBackgroundSyncRegistration,
      commitBackgroundSyncRegistration,
      getBackgroundSyncRepos,
      prepareBackgroundSync,
    } = await import('#/server/modules/background-sync.ts')
    const { acquireWorkspaceRuntime, releaseWorkspaceRuntime } = await import(
      '#/server/modules/workspace-runtimes.ts'
    )
    const clientId = 'background-sync-client'
    const workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO, clientId)
    await prepareBackgroundSync()
    const admission = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, clientId, 1, [{ workspaceId: REPO, workspaceRuntimeId }]),
    )
    commitBackgroundSyncRegistration(admission)

    releaseWorkspaceRuntime(USER_ID, REPO, workspaceRuntimeId, clientId)

    expect(getBackgroundSyncRepos(USER_ID)).toEqual([])
  })

  test('removes a client-owned target when a server resource keeps the runtime open', async () => {
    const {
      beginBackgroundSyncRegistration,
      commitBackgroundSyncRegistration,
      getBackgroundSyncRepos,
      prepareBackgroundSync,
    } = await import('#/server/modules/background-sync.ts')
    const { acquireWorkspaceRuntime, releaseWorkspaceRuntime, retainWorkspaceRuntimeResource } = await import(
      '#/server/modules/workspace-runtimes.ts'
    )
    const ownerClientId = 'background-sync-owner-client'
    const workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO, ownerClientId)
    const retention = retainWorkspaceRuntimeResource(USER_ID, REPO, workspaceRuntimeId, 'terminal-session')
    await prepareBackgroundSync()
    const admission = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, ownerClientId, 1, [{ workspaceId: REPO, workspaceRuntimeId }]),
    )
    commitBackgroundSyncRegistration(admission)

    expect(releaseWorkspaceRuntime(USER_ID, REPO, workspaceRuntimeId, ownerClientId)).toEqual({
      released: true,
      runtimeClosed: false,
    })

    expect(getBackgroundSyncRepos(USER_ID)).toEqual([])
    retention.release()
  })

  test('aborts pending admission when its Workspace membership is released', async () => {
    const { beginBackgroundSyncRegistration, commitBackgroundSyncRegistration, prepareBackgroundSync } = await import(
      '#/server/modules/background-sync.ts'
    )
    const { acquireWorkspaceRuntime, releaseWorkspaceRuntime } = await import(
      '#/server/modules/workspace-runtimes.ts'
    )
    const clientId = 'background-sync-pending-client'
    const workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO, clientId)
    await prepareBackgroundSync()
    const admission = requiredAdmission(
      beginBackgroundSyncRegistration(USER_ID, clientId, 1, [{ workspaceId: REPO, workspaceRuntimeId }]),
    )

    releaseWorkspaceRuntime(USER_ID, REPO, workspaceRuntimeId, clientId)

    expect(admission.signal.aborted).toBe(true)
    expect(commitBackgroundSyncRegistration(admission)).toBe(false)
  })
})
