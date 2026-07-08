import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  clearRepoRuntimesForUser,
  closeRepoRuntime,
  isCurrentRepoRuntime,
  onRepoRuntimeClosed,
  openRepoRuntime,
} from '#/server/modules/repo-runtimes.ts'

const USER_ID = 'user_repo_runtime'
const REPO_ROOT = '/repo-runtimes/repo'

describe('repo runtimes', () => {
  beforeEach(() => {
    clearRepoRuntimesForUser(USER_ID)
  })

  test('isolates close listener failures from the repo runtime state machine', () => {
    const first = openRepoRuntime(USER_ID, REPO_ROOT)
    const badListener = vi.fn(() => {
      throw new Error('listener failed')
    })
    const goodListener = vi.fn()
    const unsubscribeBad = onRepoRuntimeClosed(badListener)
    const unsubscribeGood = onRepoRuntimeClosed(goodListener)

    try {
      const second = openRepoRuntime(USER_ID, REPO_ROOT)

      expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, second)).toBe(true)
      expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, first)).toBe(false)
      expect(badListener).toHaveBeenCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: first })
      expect(goodListener).toHaveBeenCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: first })

      expect(closeRepoRuntime(USER_ID, REPO_ROOT, second)).toBe(true)
      expect(isCurrentRepoRuntime(USER_ID, REPO_ROOT, second)).toBe(false)
      expect(goodListener).toHaveBeenLastCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoRuntimeId: second })
    } finally {
      unsubscribeBad()
      unsubscribeGood()
      clearRepoRuntimesForUser(USER_ID)
    }
  })
})
