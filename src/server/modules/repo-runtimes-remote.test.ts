import { beforeEach, describe, expect, test } from 'vitest'
import {
  clearRepoRuntimesForUser,
  closeRepoRuntime,
  listRepoRuntimes,
  openRepoRuntime,
  runRepoRemoteLifecycle,
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
    expect(listRepoRuntimes(userId)[0]?.remoteLifecycle).toEqual({ kind: 'connecting', attemptId: 1 })

    const second = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    expect(firstSignal.aborted).toBe(true)
    await expect(second).resolves.toMatchObject({ kind: 'settled', lifecycle: { kind: 'ready', attemptId: 2 } })
    releaseFirst(ready)
    await expect(first).resolves.toEqual({ kind: 'superseded' })
    expect(listRepoRuntimes(userId)[0]?.remoteLifecycle).toMatchObject({ kind: 'ready', attemptId: 2 })
  })

  test('publishes lifecycle through the user-scoped runtime snapshot', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    expect(listRepoRuntimes(userId)).toEqual([{
      repoRoot,
      repoRuntimeId: runtimeId,
      remoteLifecycle: { kind: 'ready', attemptId: 1, target },
    }])
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
    expect(listRepoRuntimes(userId)).toEqual([{
      repoRoot, repoRuntimeId: reopened, remoteLifecycle: { kind: 'idle', attemptId: 0 },
    }])
  })

  test('normalizes an aborted predecessor rejection to a superseded result', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    const first = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      }),
    )
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    await expect(first).resolves.toEqual({ kind: 'superseded' })
  })

  test('settles a current unexpected failure instead of orphaning connecting', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    await expect(
      runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => { throw new Error('transport failed') }),
    ).resolves.toEqual({ kind: 'settled', lifecycle: { kind: 'failed', attemptId: 1, reason: 'unknown' } })
    expect(listRepoRuntimes(userId)[0]?.remoteLifecycle).toEqual({
      kind: 'failed', attemptId: 1, reason: 'unknown',
    })
  })

  test('returns stale-runtime when close replaces the running generation', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    let release!: (value: RemoteRepoConnectionResult) => void
    const work = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, () =>
      new Promise((resolve) => { release = resolve }),
    )
    closeRepoRuntime(userId, repoRoot, runtimeId)
    openRepoRuntime(userId, repoRoot)
    release(ready)
    await expect(work).resolves.toEqual({ kind: 'stale-runtime' })
  })

  test('publishes only accepted connecting and terminal transitions', async () => {
    const runtimeId = openRepoRuntime(userId, repoRoot)
    const transitions: string[] = []
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready, (lifecycle) => {
      transitions.push(`${lifecycle.kind}:${lifecycle.attemptId}`)
    })
    expect(transitions).toEqual(['connecting:1', 'ready:1'])
  })
})
