import { describe, expect, test, vi } from 'vitest'
import {
  createGitHubApiQueue,
  GITHUB_API_CONCURRENCY,
  GITHUB_API_INTERVAL_CAP,
  GITHUB_API_INTERVAL_MS,
} from '#/main/github/queue.ts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('GitHub API queue', () => {
  test('uses conservative default limits', () => {
    expect(GITHUB_API_CONCURRENCY).toBe(3)
    expect(GITHUB_API_INTERVAL_CAP).toBe(10)
    expect(GITHUB_API_INTERVAL_MS).toBe(1_000)
  })

  test('limits concurrent tasks', async () => {
    const queue = createGitHubApiQueue({ concurrency: 2, intervalCap: 100, interval: 1 })
    let active = 0
    let maxActive = 0

    await Promise.all(
      Array.from({ length: 5 }, () =>
        queue.add(async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await sleep(10)
          active -= 1
        }),
      ),
    )

    expect(maxActive).toBe(2)
  })

  test('limits task starts per interval', async () => {
    vi.useFakeTimers()
    try {
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
    } finally {
      vi.useRealTimers()
    }
  })
})
