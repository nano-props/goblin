import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  acquireRepoRuntime,
  clearRepoRuntimesForUser,
  isCurrentRepoRuntime,
  onRepoRuntimeClosed,
  releaseRepoRuntime,
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
      expect(releaseRepoRuntime(USER_ID, REPO_ROOT, first, 'client-a')).toEqual({ released: true, runtimeClosed: false })
      expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, first)).toBe(true)
      expect(goodListener).not.toHaveBeenCalled()
      expect(releaseRepoRuntime(USER_ID, REPO_ROOT, second, 'client-b')).toEqual({ released: true, runtimeClosed: true })
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
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({ released: true, runtimeClosed: true })
    expect(releaseRepoRuntime(USER_ID, REPO_ROOT, runtimeId, 'client-a')).toEqual({ released: false, runtimeClosed: false })
  })
})
