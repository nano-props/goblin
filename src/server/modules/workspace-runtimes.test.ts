import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  acquireWorkspaceRuntimeLease,
  captureWorkspaceRuntimeMembershipLease,
  clearWorkspaceRuntimesForUser,
  commitOrReadInitialWorkspaceProbeState,
  commitWorkspaceProbeState,
  expireWorkspaceRuntimeMembershipLease,
  isCurrentWorkspaceRuntime,
  isCurrentWorkspaceRuntimeMembership,
  listWorkspaceRuntimes,
  onWorkspaceRuntimeClosed,
  releaseWorkspaceRuntime,
  releaseWorkspaceRuntimeMembershipLease,
  replaceWorkspaceRuntimeMembershipsForClient,
  runSerializedWorkspaceRefresh,
  runRemoteWorkspaceLifecycle,
  workspaceRuntimeHasGitCapability,
} from '#/server/modules/workspace-runtimes.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const USER_ID = 'user_repo_runtime'
const REPO_ROOT = 'goblin+file:///workspace-runtimes/repo'

describe('workspace runtimes', () => {
  beforeEach(() => {
    clearWorkspaceRuntimesForUser(USER_ID)
  })

  test('rejects a non-canonical workspace identity at runtime admission', () => {
    expect(() => acquireWorkspaceRuntime(USER_ID, '/workspace-runtimes/repo', 'client-a')).toThrow(
      'workspace runtime requires a canonical workspaceId',
    )
    expect(listWorkspaceRuntimes(USER_ID)).toEqual([])
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
      expect(goodListener).toHaveBeenLastCalledWith({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: second })
    } finally {
      unsubscribeBad()
      unsubscribeGood()
      clearWorkspaceRuntimesForUser(USER_ID)
    }
  })

  test('commits probe state only to the current runtime epoch', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const probe = {
      status: 'ready' as const,
      name: 'repo',
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' as const },
      },
      diagnostics: [],
    }

    expect(commitWorkspaceProbeState({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: runtimeId, probe })).toBe(
      true,
    )
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual(probe)
    expect(
      commitWorkspaceProbeState({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: 'workspace-runtime-stale', probe }),
    ).toBe(false)

    releaseWorkspaceRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')
    const reopened = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(reopened).not.toBe(runtimeId)
    expect(listWorkspaceRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' })
  })

  test('keeps the first committed initial probe as the shared runtime authority', () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    const first = {
      status: 'ready' as const,
      name: 'first',
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' as const },
      },
      diagnostics: [],
    }
    const later = { ...first, name: 'later' }

    expect(
      commitOrReadInitialWorkspaceProbeState({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: runtimeId,
        probe: first,
      }),
    ).toEqual(first)
    expect(
      commitOrReadInitialWorkspaceProbeState({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: runtimeId,
        probe: later,
      }),
    ).toEqual(first)
  })

  test('serializes refresh and preserves the committed probe after an inconclusive result', async () => {
    const runtimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    const initial = {
      status: 'ready' as const,
      name: 'repo',
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    commitWorkspaceProbeState({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: runtimeId, probe: initial })
    let finishFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const calls: string[] = []
    const first = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: runtimeId,
      probe: async () => {
        calls.push('first')
        await firstGate
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
    await Promise.resolve()
    expect(calls).toEqual(['first'])
    finishFirst()
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
      name: 'repo',
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    commitWorkspaceProbeState({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: runtimeId, probe: available })
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
      name: 'repo',
      capabilities: {
        files: { read: true as const, write: true },
        terminal: { available: true },
        git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
      },
      diagnostics: [],
    }
    commitWorkspaceProbeState({ userId: USER_ID, workspaceId: REPO_ROOT, workspaceRuntimeId: runtimeId, probe: available })
    let releaseCleanup!: () => void
    let markCleanupStarted!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve
    })
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
        markCleanupStarted()
        await cleanupGate
      },
    })
    await cleanupStarted
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
    await Promise.resolve()
    expect(nextProbe).not.toHaveBeenCalled()
    releaseCleanup()
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
        name: 'repo',
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

  test('expires only memberships captured when a client went offline', () => {
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

  test('does not let an old disconnect lease remove a renewed membership', () => {
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

  test('ensure retries a failed remote lifecycle and joins the ready state', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')
    const workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, workspaceId, 'client-a')
    const failed = vi.fn(async () => ({
      kind: 'failed' as const,
      repoId: workspaceId,
      name: 'repo',
      lifecycle: { kind: 'failed' as const, reason: 'unreachable' as const },
    }))
    const ready = vi.fn(async () => ({
      kind: 'ready' as const,
      repoId: workspaceId,
      name: 'repo',
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

    await expect(
      runRemoteWorkspaceLifecycle(USER_ID, workspaceId, workspaceRuntimeId, failed, undefined, 'ensure'),
    ).resolves.toMatchObject({
      kind: 'settled',
      lifecycle: { kind: 'failed' },
    })
    await expect(
      runRemoteWorkspaceLifecycle(USER_ID, workspaceId, workspaceRuntimeId, ready, undefined, 'ensure'),
    ).resolves.toMatchObject({
      kind: 'settled',
      lifecycle: { kind: 'ready' },
    })
    expect(failed).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  test('atomically replaces one client membership set without changing sibling clients', () => {
    const firstRuntimeId = acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireWorkspaceRuntime(USER_ID, REPO_ROOT, 'client-b')
    const secondRoot = 'goblin+file:///workspace-runtimes/second'

    const reconciled = replaceWorkspaceRuntimeMembershipsForClient(USER_ID, 'client-a', [secondRoot])

    expect(reconciled).toContainEqual(
      expect.objectContaining({ workspaceId: secondRoot, workspaceRuntimeId: expect.stringMatching(/^workspace-runtime-/) }),
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

  test('publishes close events only after the replacement snapshot is complete', () => {
    const oldRoot = 'goblin+file:///workspace-runtimes/old'
    const newRoot = 'goblin+file:///workspace-runtimes/new'
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

  test('rejects an invalid declaration before changing any memberships', () => {
    const oldRoot = 'goblin+file:///workspace-runtimes/atomic-old'
    const newRoot = 'goblin+file:///workspace-runtimes/atomic-new'
    const oldRuntimeId = acquireWorkspaceRuntime(USER_ID, oldRoot, 'client-a')
    const closed = vi.fn()
    const unsubscribe = onWorkspaceRuntimeClosed(closed)
    try {
      expect(() => replaceWorkspaceRuntimeMembershipsForClient(USER_ID, '', [newRoot])).toThrow(
        'workspace runtime reconcile requires a valid clientId',
      )
      expect(() => replaceWorkspaceRuntimeMembershipsForClient(USER_ID, 'client-a', [newRoot, ''])).toThrow(
        'workspace runtime requires a canonical workspaceId',
      )
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
