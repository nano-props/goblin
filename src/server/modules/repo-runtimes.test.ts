import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  acquireRepoRuntime,
  acquireRepoRuntimeLease,
  captureRepoRuntimeMembershipLease,
  clearRepoRuntimesForUser,
  expireRepoRuntimeMembershipLease,
  isCurrentRepoRuntime,
  listRepoRuntimes,
  onRepoRuntimeClosed,
  releaseRepoRuntime,
  releaseRepoRuntimeMembershipLease,
  replaceRepoRuntimeMembershipsForClient,
  runRepoRemoteLifecycle,
} from '#/server/modules/repo-runtimes.ts'

const USER_ID = 'user_repo_runtime'
const REPO_ROOT = '/repo-runtimes/repo'

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
    const repoRoot = 'ssh-config://example/repo'
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

    await expect(runRepoRemoteLifecycle(USER_ID, repoRoot, repoRuntimeId, failed, undefined, 'ensure')).resolves.toMatchObject({
      kind: 'settled',
      lifecycle: { kind: 'failed' },
    })
    await expect(runRepoRemoteLifecycle(USER_ID, repoRoot, repoRuntimeId, ready, undefined, 'ensure')).resolves.toMatchObject({
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
