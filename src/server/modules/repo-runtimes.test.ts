import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  acquireRepoRuntime,
  acquireRepoRuntimeLease,
  captureRepoRuntimeMembershipLease,
  clearRepoRuntimesForUser,
  commitOrReadInitialWorkspaceProbeState,
  commitWorkspaceProbeState,
  expireRepoRuntimeMembershipLease,
  isCurrentRepoRuntime,
  isCurrentRepoRuntimeMembership,
  listRepoRuntimes,
  onRepoRuntimeClosed,
  releaseRepoRuntime,
  releaseRepoRuntimeMembershipLease,
  replaceRepoRuntimeMembershipsForClient,
  runSerializedWorkspaceRefresh,
  runRepoRemoteLifecycle,
  workspaceRuntimeHasGitCapability,
} from '#/server/modules/repo-runtimes.ts'

const USER_ID = 'user_repo_runtime'
const REPO_ROOT = 'goblin+file:///repo-runtimes/repo'

describe('repo runtimes', () => {
  beforeEach(() => {
    clearRepoRuntimesForUser(USER_ID)
  })

  test('shares an epoch until the last client releases it', () => {
    const first = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    const badListener = vi.fn(() => {
      throw new Error('listener failed')
    })
    const goodListener = vi.fn()
    const unsubscribeBad = onRepoRuntimeClosed(badListener)
    const unsubscribeGood = onRepoRuntimeClosed(goodListener)

    try {
      const second = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-b')
      expect(second).toBe(first)
      expect(releaseRepoRuntime(USER_ID, REPO_ROOT, first, 'client-a')).toEqual({
        released: true,
        runtimeClosed: false,
      })
      expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, first)).toBe(true)
      expect(goodListener).not.toHaveBeenCalled()
      expect(releaseRepoRuntime(USER_ID, REPO_ROOT, second, 'client-b')).toEqual({
        released: true,
        runtimeClosed: true,
      })
      expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, second)).toBe(false)
      expect(goodListener).toHaveBeenLastCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: second })
    } finally {
      unsubscribeBad()
      unsubscribeGood()
      clearRepoRuntimesForUser(USER_ID)
    }
  })

  test('commits probe state only to the current runtime epoch', () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
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

    expect(commitWorkspaceProbeState({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: runtimeId, probe })).toBe(
      true,
    )
    expect(listRepoRuntimes(USER_ID)[0]?.workspaceProbe).toEqual(probe)
    expect(
      commitWorkspaceProbeState({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: 'repo-runtime-stale', probe }),
    ).toBe(false)

    releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')
    const reopened = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(reopened).not.toBe(runtimeId)
    expect(listRepoRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' })
  })

  test('keeps the first committed initial probe as the shared runtime authority', () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-b')
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
        repoRoot: REPO_ROOT,
        repoRuntimeId: runtimeId,
        probe: first,
      }),
    ).toEqual(first)
    expect(
      commitOrReadInitialWorkspaceProbeState({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        repoRuntimeId: runtimeId,
        probe: later,
      }),
    ).toEqual(first)
  })

  test('serializes refresh and preserves the committed probe after an inconclusive result', async () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
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
    commitWorkspaceProbeState({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: runtimeId, probe: initial })
    let finishFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const calls: string[] = []
    const first = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      repoRuntimeId: runtimeId,
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: runtimeId,
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
    expect(listRepoRuntimes(USER_ID)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
      diagnostics: [],
    })
  })

  test('does not commit a capability transition when transactional cleanup fails', async () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
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
    commitWorkspaceProbeState({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: runtimeId, probe: available })
    const unavailable = {
      ...available,
      capabilities: { ...available.capabilities, git: { status: 'unavailable' as const } },
    }

    await expect(
      runSerializedWorkspaceRefresh({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        repoRuntimeId: runtimeId,
        probe: async () => unavailable,
        beforeCommit: async () => {
          throw new Error('cleanup failed')
        },
      }),
    ).rejects.toThrow('cleanup failed')
    expect(listRepoRuntimes(USER_ID)[0]?.workspaceProbe).toEqual(available)
  })

  test('keeps close and reopen in the same epoch while lifecycle cleanup is active', async () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
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
    commitWorkspaceProbeState({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: runtimeId, probe: available })
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: runtimeId,
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
    expect(listRepoRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' })
    expect(workspaceRuntimeHasGitCapability(USER_ID, REPO_ROOT, runtimeId)).toBe(false)
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: false,
    })
    const reopened = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(reopened).toBe(runtimeId)
    const nextProbe = vi.fn(async () => available)
    const newRefresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      repoRuntimeId: reopened,
      probe: nextProbe,
    })
    await Promise.resolve()
    expect(nextProbe).not.toHaveBeenCalled()
    releaseCleanup()
    await expect(oldRefresh).resolves.toMatchObject({ kind: 'committed' })
    await expect(newRefresh).resolves.toMatchObject({ kind: 'committed' })
  })

  test('closes an empty epoch only after its active lifecycle cleanup finishes', async () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    const closed = vi.fn()
    const unsubscribe = onRepoRuntimeClosed(closed)
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const refresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      repoRuntimeId: runtimeId,
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
    await vi.waitFor(() => expect(listRepoRuntimes(USER_ID)[0]?.workspaceProbe).toEqual({ status: 'probing' }))

    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: false,
    })
    expect(closed).not.toHaveBeenCalled()
    releaseCleanup()
    await expect(refresh).resolves.toMatchObject({ kind: 'committed' })
    expect(closed).toHaveBeenCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: runtimeId })
    expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, runtimeId)).toBe(false)
    unsubscribe()
  })

  test('test reset fast-fails while a lifecycle operation is active', async () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    const gate = Promise.withResolvers<void>()
    const refresh = runSerializedWorkspaceRefresh({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      repoRuntimeId: runtimeId,
      probe: async () => {
        await gate.promise
        return { status: 'unavailable', reason: 'error.workspace-transport-unavailable' }
      },
    })

    expect(() => clearRepoRuntimesForUser(USER_ID)).toThrow('active workspace lifecycle operations')
    gate.resolve()
    await refresh
  })

  test('makes repeated acquire and release idempotent per client', () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')).toBe(runtimeId)
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: true,
    })
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: false,
      runtimeClosed: false,
    })
  })

  test('checks runtime authority and client lease together', () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    expect(isCurrentRepoRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toBe(true)
    expect(isCurrentRepoRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toBe(false)
    acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-b')
    expect(isCurrentRepoRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toBe(true)
    releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')
    expect(isCurrentRepoRuntimeMembership(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toBe(false)
  })

  test('expires only memberships captured when a client went offline', () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-b')
    const lease = captureRepoRuntimeMembershipLease(USER_ID, 'client-a')

    expect(expireRepoRuntimeMembershipLease(lease)).toEqual([])
    expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, runtimeId)).toBe(true)
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: false,
      runtimeClosed: false,
    })
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-b')).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('does not let an old disconnect lease remove a renewed membership', () => {
    const runtimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    const staleLease = captureRepoRuntimeMembershipLease(USER_ID, 'client-a')
    expect(acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')).toBe(runtimeId)

    expect(expireRepoRuntimeMembershipLease(staleLease)).toEqual([])
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('does not let an old explicit membership lease remove a renewed membership', () => {
    const staleLease = acquireRepoRuntimeLease(USER_ID, REPO_ROOT, 'client-a')
    const renewedLease = acquireRepoRuntimeLease(USER_ID, REPO_ROOT, 'client-a')

    expect(releaseRepoRuntimeMembershipLease(USER_ID, 'client-a', staleLease)).toEqual({
      released: false,
      runtimeClosed: false,
    })
    expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, renewedLease.repoRuntimeId)).toBe(true)
    expect(releaseRepoRuntimeMembershipLease(USER_ID, 'client-a', renewedLease)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('ensure retries a failed remote lifecycle and joins the ready state', async () => {
    const repoRoot = 'goblin+ssh://example/repo'
    const repoRuntimeId = acquireRepoRuntime(USER_ID, repoRoot, 'client-a')
    const failed = vi.fn(async () => ({
      kind: 'failed' as const,
      repoId: repoRoot,
      name: 'repo',
      lifecycle: { kind: 'failed' as const, reason: 'unreachable' as const },
    }))
    const ready = vi.fn(async () => ({
      kind: 'ready' as const,
      repoId: repoRoot,
      name: 'repo',
      gitAvailable: true,
      lifecycle: {
        kind: 'ready' as const,
        target: {
          id: repoRoot,
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
      runRepoRemoteLifecycle(USER_ID, repoRoot, repoRuntimeId, failed, undefined, 'ensure'),
    ).resolves.toMatchObject({
      kind: 'settled',
      lifecycle: { kind: 'failed' },
    })
    await expect(
      runRepoRemoteLifecycle(USER_ID, repoRoot, repoRuntimeId, ready, undefined, 'ensure'),
    ).resolves.toMatchObject({
      kind: 'settled',
      lifecycle: { kind: 'ready' },
    })
    expect(failed).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  test('atomically replaces one client membership set without changing sibling clients', () => {
    const firstRuntimeId = acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-a')
    acquireRepoRuntime(USER_ID, REPO_ROOT, 'client-b')
    const secondRoot = '/repo-runtimes/second'

    const reconciled = replaceRepoRuntimeMembershipsForClient(USER_ID, 'client-a', [secondRoot])

    expect(reconciled).toContainEqual(
      expect.objectContaining({ repoRoot: secondRoot, repoRuntimeId: expect.stringMatching(/^repo-runtime-/) }),
    )
    expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, firstRuntimeId)).toBe(true)
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, firstRuntimeId, 'client-a')).toEqual({
      released: false,
      runtimeClosed: false,
    })
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, firstRuntimeId, 'client-b')).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('publishes close events only after the replacement snapshot is complete', () => {
    const oldRoot = '/repo-runtimes/old'
    const newRoot = '/repo-runtimes/new'
    acquireRepoRuntime(USER_ID, oldRoot, 'client-a')
    const observedSnapshots: string[][] = []
    const unsubscribe = onRepoRuntimeClosed(() => {
      observedSnapshots.push(listRepoRuntimes(USER_ID).map((entry) => entry.repoRoot))
    })
    try {
      replaceRepoRuntimeMembershipsForClient(USER_ID, 'client-a', [newRoot])
      expect(observedSnapshots).toEqual([[newRoot]])
    } finally {
      unsubscribe()
    }
  })

  test('rejects an invalid declaration before changing any memberships', () => {
    const oldRoot = '/repo-runtimes/atomic-old'
    const newRoot = '/repo-runtimes/atomic-new'
    const oldRuntimeId = acquireRepoRuntime(USER_ID, oldRoot, 'client-a')
    const closed = vi.fn()
    const unsubscribe = onRepoRuntimeClosed(closed)
    try {
      expect(() => replaceRepoRuntimeMembershipsForClient(USER_ID, '', [newRoot])).toThrow(
        'repo runtime reconcile requires a valid clientId',
      )
      expect(() => replaceRepoRuntimeMembershipsForClient(USER_ID, 'client-a', [newRoot, ''])).toThrow(
        'repo runtime reconcile requires non-empty repo roots',
      )
      expect(listRepoRuntimes(USER_ID)).toEqual([
        expect.objectContaining({ repoRoot: oldRoot, repoRuntimeId: oldRuntimeId }),
      ])
      expect(closed).not.toHaveBeenCalled()
      expect(releaseRepoRuntime(USER_ID, oldRoot, oldRuntimeId, 'client-a')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      unsubscribe()
    }
  })
})
