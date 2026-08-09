import { describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import {
  createGitHubApiQueue,
  GITHUB_API_CONCURRENCY,
  GITHUB_API_INTERVAL_CAP,
  GITHUB_API_INTERVAL_MS,
} from '#/system/github/queue.ts'

describe('GitHub API request queue', () => {
  test('uses conservative default limits', () => {
    expect(GITHUB_API_CONCURRENCY).toBe(3)
    expect(GITHUB_API_INTERVAL_CAP).toBe(10)
    expect(GITHUB_API_INTERVAL_MS).toBe(1_000)
  })

  test('limits concurrent tasks', async () => {
    const queue = createGitHubApiQueue({ concurrency: 2, intervalCap: 100, interval: 1 })
    const gate = Promise.withResolvers<void>()
    let active = 0
    let maxActive = 0

    const tasks = Promise.all(
      Array.from({ length: 5 }, () =>
        queue.add(async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await gate.promise
          active -= 1
        }),
      ),
    )
    await vi.waitFor(() => expect(active).toBe(2))
    gate.resolve()
    await tasks

    expect(maxActive).toBe(2)
  })

  test('limits task starts per interval', async () => {
    useFakeTimers()
    const queue = createGitHubApiQueue({ concurrency: 10, intervalCap: 2, interval: 40 })
    let started = 0

    const tasks = Array.from({ length: 3 }, () =>
      queue.add(() => {
        started += 1
      }),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBe(2)

    await vi.advanceTimersByTimeAsync(40)
    await Promise.all(tasks)
    expect(started).toBe(3)
  })
})
