import { beforeEach, describe, expect, test } from 'vitest'
import {
  clearRepoRuntimesForUser,
  closeRepoRuntime,
  getRepoRemoteLifecycle,
  openRepoRuntime,
  runRepoRemoteLifecycle,
  StaleRepoRuntimeError,
} from '#/server/modules/repo-runtimes.ts'
import type { RemoteRepoConnectionResult, RemoteRepoTarget } from '#/shared/remote-repo.ts'

const userId = 'user_test'
const repoRoot = 'ssh-config://example/repo'
const target: RemoteRepoTarget = {
  id: repoRoot,
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/repo',
  displayName: 'example:repo',
}
const ready: RemoteRepoConnectionResult = {
  kind: 'ready', repoId: repoRoot, name: 'repo', lifecycle: { kind: 'ready', target },
}

describe('repo runtime remote lifecycle', () => {
  beforeEach(() => clearRepoRuntimesForUser(userId))

  test('latest attempt aborts its predecessor and owns the terminal state', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    let releaseFirst!: (value: RemoteRepoConnectionResult) => void
    let firstSignal!: AbortSignal
    const first = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, (signal) => {
      firstSignal = signal
      return new Promise((resolve) => { releaseFirst = resolve })
    })
    expect(getRepoRemoteLifecycle(userId, repoRoot, runtimeId)).toEqual({ kind: 'connecting', attemptId: 1 })

    const second = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    expect(firstSignal.aborted).toBe(true)
    await expect(second).resolves.toMatchObject({ kind: 'ready', attemptId: 2 })
    releaseFirst(ready)
    await expect(first).rejects.toBeInstanceOf(StaleRepoRuntimeError)
    expect(getRepoRemoteLifecycle(userId, repoRoot, runtimeId)).toMatchObject({ kind: 'ready', attemptId: 2 })
  })

  test('close aborts the attempt and a reopened generation starts from idle', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    let signal!: AbortSignal
    void runRepoRemoteLifecycle(userId, repoRoot, runtimeId, (nextSignal) => {
      signal = nextSignal
      return new Promise(() => {})
    })
    expect(closeRepoRuntime(userId, repoRoot, runtimeId)).toBe(true)
    expect(signal.aborted).toBe(true)
    const reopened = openRepoRuntime(userId, repoRoot)
    expect(getRepoRemoteLifecycle(userId, repoRoot, reopened)).toEqual({ kind: 'idle', attemptId: 0 })
    expect(() => getRepoRemoteLifecycle(userId, repoRoot, runtimeId)).toThrow(StaleRepoRuntimeError)
  })

  test('normalizes an aborted predecessor rejection to a stale generation', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    const first = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      }),
    )
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    await expect(first).rejects.toBeInstanceOf(StaleRepoRuntimeError)
  })
})
