import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  clearRepoRuntimeInstancesForUser,
  closeRepoRuntimeInstance,
  isCurrentRepoRuntimeInstance,
  onRepoRuntimeInstanceClosed,
  openRepoRuntimeInstance,
} from '#/server/modules/repo-runtime-instances.ts'

const USER_ID = 'user_repo_runtime_instances'
const REPO_ROOT = '/repo-runtime-instances/repo'

describe('repo runtime instances', () => {
  beforeEach(() => {
    clearRepoRuntimeInstancesForUser(USER_ID)
  })

  test('isolates close listener failures from the repo runtime state machine', () => {
    const first = openRepoRuntimeInstance(USER_ID, REPO_ROOT)
    const badListener = vi.fn(() => {
      throw new Error('listener failed')
    })
    const goodListener = vi.fn()
    const unsubscribeBad = onRepoRuntimeInstanceClosed(badListener)
    const unsubscribeGood = onRepoRuntimeInstanceClosed(goodListener)

    try {
      const second = openRepoRuntimeInstance(USER_ID, REPO_ROOT)

      expect(isCurrentRepoRuntimeInstance(USER_ID, REPO_ROOT, second)).toBe(true)
      expect(isCurrentRepoRuntimeInstance(USER_ID, REPO_ROOT, first)).toBe(false)
      expect(badListener).toHaveBeenCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoInstanceId: first })
      expect(goodListener).toHaveBeenCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoInstanceId: first })

      expect(closeRepoRuntimeInstance(USER_ID, REPO_ROOT, second)).toBe(true)
      expect(isCurrentRepoRuntimeInstance(USER_ID, REPO_ROOT, second)).toBe(false)
      expect(goodListener).toHaveBeenLastCalledWith({ userId: USER_ID, repoRoot: REPO_ROOT, repoInstanceId: second })
    } finally {
      unsubscribeBad()
      unsubscribeGood()
      clearRepoRuntimeInstancesForUser(USER_ID)
    }
  })
})
