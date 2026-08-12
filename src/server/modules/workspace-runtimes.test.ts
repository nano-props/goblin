import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  acquireWorkspaceRuntimeLease,
  captureWorkspaceRuntimeMembershipCapability,
  captureWorkspaceRuntimeMembershipLease,
  clearWorkspaceRuntimesForUser,
  closeWorkspaceRuntimesForDurableRemoval,
  expireWorkspaceRuntimeMembershipLease,
  isCurrentWorkspaceRuntime,
  isCurrentWorkspaceRuntimeMembership,
  listWorkspaceRuntimes,
  onWorkspaceRuntimeClosed,
  onWorkspaceRuntimeFailed,
  releaseWorkspaceRuntime,
  releaseWorkspaceRuntimeMembershipLease,
  retainWorkspaceRuntimeResource,
  replaceWorkspaceRuntimeMembershipsForClient,
  runSerializedInitialWorkspaceProbe,
  runSerializedWorkspaceRefresh,
  runRemoteWorkspaceLifecycle,
  workspaceRuntimeHasGitCapability,
  withWorkspaceRuntimeAdmission,
  WorkspaceRuntimeStaleError,
} from '#/server/modules/workspace-runtimes.ts'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

const USER_ID = 'user_repo_runtime'
const REPO_ROOT = workspaceIdForTest('goblin+file:///workspace-runtimes/repo')

async function settleInitialProbe(workspaceRuntimeId: string, probe: WorkspaceSettledProbeState) {
  return await runSerializedInitialWorkspaceProbe({
    userId: USER_ID,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId,
    probe: async () => probe,
  })
}

describe('workspace runtimes', () => {
  beforeEach(() => {
    clearWorkspaceRuntimesForUser(USER_ID)
  })

  test('shares an epoch until the last client releases it', () => {
    const first = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const badListener = vi.fn(() => {
      throw new Error('listener failed')
    })
    const goodListener = vi.fn()
    const unsubscribeBad = onWorkspaceRuntimeClosed(badListener)
    const unsubscribeGood = onWorkspaceRuntimeClosed(goodListener)

    try {
      const second = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
      expect(second).toBe(first)
      expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, first, 'client-a')).toEqual({
        released: true,
        runtimeClosed: false,
      })
      expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, first)).toBe(true)
      expect(goodListener).not.toHaveBeenCalled()
      expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, second, 'client-b')).toEqual({
        released: true,
        runtimeClosed: true,
      })
      expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, second)).toBe(false)
      expect(goodListener).toHaveBeenLastCalledWith({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: second,
      })
    } finally {
      unsubscribeBad()
      unsubscribeGood()
      clearWorkspaceRuntimesForUser(USER_ID)
    }
  })

  test('keeps an epoch alive while a server resource retains it', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const retention = retainWorkspaceRuntimeResource(USER_ID, REPO_ROOT, runtimeId, 'terminal-a')

    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: false,
    })
    expect(acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')).toBe(runtimeId)
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toEqual({
      released: true,
      runtimeClosed: false,
    })

    retention.release()
    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId)).toBe(false)
  })

  test('rejects resource retention for a stale runtime with the canonical error', () => {
    expect(() => retainWorkspaceRuntimeResource(USER_ID, REPO_ROOT, 'runtime-stale', 'terminal-a')).toThrow(
      WorkspaceRuntimeStaleError,
    )
  })

  test('does not let a stale resource retention release affect a later epoch', () => {
    const oldRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const staleRetention = retainWorkspaceRuntimeResource(USER_ID, REPO_ROOT, oldRuntimeId, 'terminal-a')
    expect(closeWorkspaceRuntimesForDurableRemoval(REPO_ROOT)).toBe(1)
    const newRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    retainWorkspaceRuntimeResource(USER_ID, REPO_ROOT, newRuntimeId, 'terminal-a')

    staleRetention.release()

    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, newRuntimeId)).toBe(true)
  })

  test('durable removal closes every user epoch regardless of its owners', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    retainWorkspaceRuntimeResource(USER_ID, REPO_ROOT, runtimeId, 'terminal-a')
    const otherUserId = `${USER_ID}_other`
    const otherRuntimeId = acquireWorkspaceRuntime(otherUserId, REPO_ROOT, 'client-b')
    retainWorkspaceRuntimeResource(otherUserId, REPO_ROOT, otherRuntimeId, 'terminal-b')
    const closed = vi.fn()
    const unsubscribe = onWorkspaceRuntimeClosed(closed)
    try {
      expect(closeWorkspaceRuntimesForDurableRemoval(REPO_ROOT)).toBe(2)
      expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId)).toBe(false)
      expect(isCurrentWorkspaceRuntime(otherUserId, REPO_ROOT, otherRuntimeId)).toBe(false)
      expect(closed.mock.calls.map(([event]) => event)).toEqual([
        { userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: runtimeId },
        { userId: otherUserId, workspaceId: REPO_ROOT, workspaceRuntimeId: otherRuntimeId },
      ])
    } finally {
      unsubscribe()
      clearWorkspaceRuntimesForUser(otherUserId)
    }
  })

  test('reports canonical stale when durable removal interrupts an initial probe commit', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const beforeCommitStarted = Promise.withResolvers<void>()
    const finishBeforeCommit = Promise.withResolvers<void>()
    const probe = {
      status: 'ready' as const,
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' as const },
      },
      diagnostics: [],
    }
    const work = runSerializedInitialWorkspaceProbe({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => probe,
      beforeCommit: async () => {
        beforeCommitStarted.resolve()
        await finishBeforeCommit.promise
        throw new Error('late capability transition failure')
      },
    })
    await beforeCommitStarted.promise

    expect(closeWorkspaceRuntimesForDurableRemoval(REPO_ROOT)).toBe(1)
    finishBeforeCommit.resolve()

    await expect(work).rejects.toBeInstanceOf(WorkspaceRuntimeStaleError)
  })

  test('commits probe state only to the current runtime epoch', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const probe = {
      status: 'ready' as const,
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' as const },
      },
      diagnostics: [],
    }

    await settleInitialProbe(runtimeId, probe)
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual(probe)
    await expect(
      runSerializedInitialWorkspaceProbe({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: 'workspace-runtime-stale',
        probe: async () => probe,
      }),
    ).rejects.toBeInstanceOf(WorkspaceRuntimeStaleError)

    releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')
    const reopened = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(reopened).not.toBe(runtimeId)
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' })
  })

  test('keeps the first committed initial probe as the shared runtime authority', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    const first = {
      status: 'ready' as const,
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' as const },
      },
      diagnostics: [],
    }
    const later = {
      ...first,
      capabilities: { ...first.capabilities, terminal: { available: false } },
    }

    await expect(settleInitialProbe(runtimeId, first)).resolves.toEqual(first)
    await expect(settleInitialProbe(runtimeId, later)).resolves.toEqual(first)
  })

  test('serializes refresh and preserves the committed probe after an inconclusive result', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const initial = {
      status: 'ready' as const,
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    await settleInitialProbe(runtimeId, initial)
    const firstStarted = Promise.withResolvers<void>()
    const firstGate = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => {
        calls.push('first')
        firstStarted.resolve()
        await firstGate.promise
        return {
          ...initial,
          capabilities: { ...initial.capabilities, git: { status: 'unavailable' as const } },
        }
      },
    })
    const second = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => {
        calls.push('second')
        return { ...initial, diagnostics: [{ scope: 'git' as const, message: 'git timed out' }] }
      },
    })
    await firstStarted.promise
    expect(calls).toEqual(['first'])
    firstGate.resolve()
    await expect(first).resolves.toMatchObject({ kind: 'committed' })
    await expect(second).resolves.toMatchObject({ kind: 'failed' })
    expect(calls).toEqual(['first', 'second'])
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
      diagnostics: [],
    })
  })

  test('does not commit a capability transition when transactional cleanup fails', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const available = {
      status: 'ready' as const,
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    await settleInitialProbe(runtimeId, available)
    const unavailable = {
      ...available,
      capabilities: { ...available.capabilities, git: { status: 'unavailable' as const } },
    }

    await expect(
      runSerializedWorkspaceRefresh({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: runtimeId,
        probe: async () => unavailable,
        beforeCommit: async () => {
          throw new Error('cleanup failed')
        },
      }),
    ).rejects.toThrow('cleanup failed')
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual(available)
  })

  test('keeps close and reopen in the same epoch while lifecycle cleanup is active', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const available = {
      status: 'ready' as const,
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    await settleInitialProbe(runtimeId, available)
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()
    let durableCleanupCommitted = false
    const oldRefresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => ({
        ...available,
        capabilities: { ...available.capabilities, git: { status: 'unavailable' as const } },
      }),
      beforeCommit: async () => {
        durableCleanupCommitted = true
        cleanupStarted.resolve()
        await cleanupGate.promise
      },
    })
    await cleanupStarted.promise
    expect(durableCleanupCommitted).toBe(true)
    // The downgrade is the transition's linearization point. While derived
    // cleanup is pending, readers see neither the old Git authority nor a
    // half-cleaned plain-workspace projection.
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' })
    expect(workspaceRuntimeHasGitCapability(USER_ID, REPO_ROOT, runtimeId)).toBe(false)
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: false,
    })
    const reopened = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(reopened).toBe(runtimeId)
    const nextProbe = vi.fn(async () => available)
    const newRefresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: reopened,
      probe: nextProbe,
    })
    await waitForNextMacrotask()
    expect(nextProbe).not.toHaveBeenCalled()
    cleanupGate.resolve()
    await expect(oldRefresh).resolves.toMatchObject({ kind: 'committed' })
    await expect(newRefresh).resolves.toMatchObject({ kind: 'committed' })
  })

  test('closes an empty epoch only after its active lifecycle cleanup finishes', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const closed = vi.fn()
    const unsubscribe = onWorkspaceRuntimeClosed(closed)
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const refresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => ({
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      }),
      beforeCommit: async () => await cleanupGate,
    })
    await vi.waitFor(() => expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' }))

    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: false,
    })
    expect(closed).not.toHaveBeenCalled()
    releaseCleanup()
    await expect(refresh).resolves.toMatchObject({ kind: 'committed' })
    expect(closed).toHaveBeenCalledWith({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: runtimeId })
    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId)).toBe(false)
    unsubscribe()
  })

  test('test reset fast-fails while a lifecycle operation is active', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const gate = Promise.withResolvers<void>()
    const refresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => {
        await gate.promise
        return { status: 'unavailable', reason: 'error.workspace-transport-unavailable' }
      },
    })

    expect(() => clearWorkspaceRuntimesForUser(USER_ID)).toThrow('active workspace lifecycle operations')
    gate.resolve()
    await refresh
  })

  test('makes repeated acquire and release idempotent per client', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')).toBe(runtimeId)
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: true,
    })
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: false,
      runtimeClosed: false,
    })
  })

  test('checks runtime authority and client lease together', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(isCurrentWorkspaceRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toBe(true)
    expect(isCurrentWorkspaceRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toBe(false)
    acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    expect(isCurrentWorkspaceRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toBe(true)
    releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')
    expect(isCurrentWorkspaceRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toBe(false)
  })

  test('expires only memberships captured when a client went offline', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    const lease = captureWorkspaceRuntimeMembershipLease(USER_ID, 'client-a')

    expect(expireWorkspaceRuntimeMembershipLease(lease)).toEqual([])
    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId)).toBe(true)
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: false,
      runtimeClosed: false,
    })
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('does not let an old disconnect lease remove a renewed membership', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const staleLease = captureWorkspaceRuntimeMembershipLease(USER_ID, 'client-a')
    expect(acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')).toBe(runtimeId)

    expect(expireWorkspaceRuntimeMembershipLease(staleLease)).toEqual([])
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('does not let an old explicit membership lease remove a renewed membership', () => {
    const staleLease = acquireWorkspaceRuntimeLease(USER_ID, REPO_ROOT, 'client-a')
    const renewedLease = acquireWorkspaceRuntimeLease(USER_ID, REPO_ROOT, 'client-a')

    expect(releaseWorkspaceRuntimeMembershipLease(USER_ID, 'client-a', staleLease)).toEqual({
      released: false,
      runtimeClosed: false,
    })
    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, renewedLease.workspaceRuntimeId)).toBe(true)
    expect(releaseWorkspaceRuntimeMembershipLease(USER_ID, 'client-a', renewedLease)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('invalidates a captured membership capability when the client renews its generation', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const capability = captureWorkspaceRuntimeMembershipCapability(USER_ID, REPO_ROOT, runtimeId, 'client-a')

    expect(() => capability.assertCurrent()).not.toThrow()
    expect(acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')).toBe(runtimeId)
    expect(() => capability.assertCurrent()).toThrow('error.workspace-runtime-stale')
  })

  test('ensure retries a failed remote lifecycle and joins the ready state', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')
    const workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, workspaceId, 'client-a')
    const failed = vi.fn(async () => ({
      kind: 'failed' as const,
      lifecycle: { kind: 'failed' as const, reason: 'unreachable' as const },
    }))
    const ready = vi.fn(async () => ({
      kind: 'ready' as const,
      gitAvailable: true,
      lifecycle: {
        kind: 'ready' as const,
        target: {
          id: workspaceId,
          alias: 'example',
          host: 'example.test',
          user: 'developer',
          port: 22,
          remotePath: '/repo',
          displayName: 'repo',
        },
      },
    }))
    const failedEvents = vi.fn()
    const unsubscribeFailed = onWorkspaceRuntimeFailed(failedEvents)

    try {
      await expect(
        runRemoteWorkspaceLifecycle(USER_ID, workspaceId, workspaceRuntimeId, failed, undefined, 'ensure'),
      ).resolves.toMatchObject({
        kind: 'settled',
        lifecycle: { kind: 'failed' },
      })
      expect(failedEvents).toHaveBeenCalledOnce()
      expect(failedEvents).toHaveBeenCalledWith({ userId: USER_ID, workspaceId, workspaceRuntimeId })

      await expect(
        runRemoteWorkspaceLifecycle(USER_ID, workspaceId, workspaceRuntimeId, ready, undefined, 'ensure'),
      ).resolves.toMatchObject({
        kind: 'settled',
        lifecycle: { kind: 'ready' },
      })
      expect(failedEvents).toHaveBeenCalledOnce()
      expect(failed).toHaveBeenCalledTimes(1)
      expect(ready).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribeFailed()
    }
  })

  test('atomically replaces one client membership set without changing sibling clients', () => {
    const firstRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    const secondRoot = workspaceIdForTest('goblin+file:///workspace-runtimes/second')

    const reconciled = replaceWorkspaceRuntimeMembershipsForClient(USER_ID, 'client-a', [secondRoot])

    expect(reconciled).toContainEqual(
      expect.objectContaining({
        workspaceId: secondRoot,
        workspaceRuntimeId: expect.stringMatching(/^workspace-runtime-/),
      }),
    )
    expect(isCurrentWorkspaceRuntime(USER_ID, REPO_ROOT, firstRuntimeId)).toBe(true)
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, firstRuntimeId, 'client-a')).toEqual({
      released: false,
      runtimeClosed: false,
    })
    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, firstRuntimeId, 'client-b')).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('invalidates every admission accepted before a complete membership declaration', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const finishFirst = Promise.withResolvers<void>()
    const first = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', async () => {
      firstStarted.resolve()
      await finishFirst.promise
      return 'first'
    })
    await firstStarted.promise

    const runQueuedAdmission = vi.fn(async () => 'queued')
    const queued = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', runQueuedAdmission)

    expect(replaceWorkspaceRuntimeMembershipsForClient(USER_ID, 'client-a', [])).toEqual([])
    finishFirst.resolve()

    await expect(first).rejects.toThrow('error.workspace-runtime-stale')
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(runQueuedAdmission).not.toHaveBeenCalled()
    expect(listWorkspaceRuntimes(USER_ID)).toEqual([])

    await expect(
      withWorkspaceRuntimeAdmission(
        USER_ID,
        REPO_ROOT,
        'client-a',
        async ({ workspaceRuntimeId }) => workspaceRuntimeId,
      ),
    ).resolves.toMatch(/^workspace-runtime-/)
    expect(listWorkspaceRuntimes(USER_ID)).toHaveLength(1)
  })

  test('invalidates an accepted admission before it can create runtime state', async () => {
    const runAdmission = vi.fn(async () => 'opened')
    const admission = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', runAdmission)

    expect(replaceWorkspaceRuntimeMembershipsForClient(USER_ID, 'client-a', [])).toEqual([])

    await expect(admission).rejects.toThrow('error.workspace-runtime-stale')
    expect(runAdmission).not.toHaveBeenCalled()
    expect(listWorkspaceRuntimes(USER_ID)).toEqual([])
  })

  test('invalidates queued admissions when the client releases the runtime', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const finishFirst = Promise.withResolvers<void>()
    const first = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', async ({ workspaceRuntimeId }) => {
      firstStarted.resolve()
      await finishFirst.promise
      return workspaceRuntimeId
    })
    await firstStarted.promise
    const workspaceRuntimeId = listWorkspaceRuntimes(USER_ID)[0]?.workspaceRuntimeId
    if (!workspaceRuntimeId) throw new Error('missing pending admission runtime')
    const runQueuedAdmission = vi.fn(async () => 'queued')
    const queued = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', runQueuedAdmission)

    expect(releaseWorkspaceRuntime(USER_ID, REPO_ROOT, workspaceRuntimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: true,
    })
    finishFirst.resolve()

    await expect(first).rejects.toThrow('error.workspace-runtime-stale')
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(runQueuedAdmission).not.toHaveBeenCalled()
    expect(listWorkspaceRuntimes(USER_ID)).toEqual([])
  })

  test('invalidates queued admissions when durable membership is removed', async () => {
    const firstStarted = Promise.withResolvers<void>()
    const finishFirst = Promise.withResolvers<void>()
    const first = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', async () => {
      firstStarted.resolve()
      await finishFirst.promise
      return 'first'
    })
    await firstStarted.promise
    const runQueuedAdmission = vi.fn(async () => 'queued')
    const queued = withWorkspaceRuntimeAdmission(USER_ID, REPO_ROOT, 'client-a', runQueuedAdmission)

    expect(closeWorkspaceRuntimesForDurableRemoval(REPO_ROOT)).toBe(1)
    finishFirst.resolve()

    await expect(first).rejects.toThrow('error.workspace-runtime-stale')
    await expect(queued).rejects.toThrow('error.workspace-runtime-stale')
    expect(runQueuedAdmission).not.toHaveBeenCalled()
    expect(listWorkspaceRuntimes(USER_ID)).toEqual([])
  })

  test('publishes close events only after the replacement snapshot is complete', () => {
    const oldRoot = workspaceIdForTest('goblin+file:///workspace-runtimes/old')
    const newRoot = workspaceIdForTest('goblin+file:///workspace-runtimes/new')
    acquireWorkspaceRuntime(USER_ID, oldRoot, 'client-a')
    const observedSnapshots: string[][] = []
    const unsubscribe = onWorkspaceRuntimeClosed(() => {
      observedSnapshots.push(listWorkspaceRuntimes(USER_ID).map((entry) => entry.workspaceId))
    })
    try {
      replaceWorkspaceRuntimeMembershipsForClient(USER_ID, 'client-a', [newRoot])
      expect(observedSnapshots).toEqual([[newRoot]])
    } finally {
      unsubscribe()
    }
  })

  test('rejects invalid declaration metadata before changing any memberships', () => {
    const oldRoot = workspaceIdForTest('goblin+file:///workspace-runtimes/atomic-old')
    const newRoot = workspaceIdForTest('goblin+file:///workspace-runtimes/atomic-new')
    const oldRuntimeId = acquireWorkspaceRuntime(USER_ID, oldRoot, 'client-a')
    const closed = vi.fn()
    const unsubscribe = onWorkspaceRuntimeClosed(closed)
    try {
      expect(() => replaceWorkspaceRuntimeMembershipsForClient(USER_ID, '', [newRoot])).toThrow(
        'workspace runtime reconcile requires a valid clientId',
      )
      expect(() =>
        replaceWorkspaceRuntimeMembershipsForClient(
          USER_ID,
          'client-a',
          Array.from({ length: 101 }, () => newRoot),
        ),
      ).toThrow('workspace runtime reconcile accepts at most 100 workspace ids')
      expect(listWorkspaceRuntimes(USER_ID)).toEqual([
        expect.objectContaining({ workspaceId: oldRoot, workspaceRuntimeId: oldRuntimeId }),
      ])
      expect(closed).not.toHaveBeenCalled()
      expect(releaseWorkspaceRuntime(USER_ID, oldRoot, oldRuntimeId, 'client-a')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      unsubscribe()
    }
  })
})
