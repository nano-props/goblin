import { beforeEach, describe, expect, test } from 'vitest'
import {
  acquireRepoRuntime,
  clearRepoRuntimesForUser,
  listRepoRuntimes,
  releaseRepoRuntime,
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
const clientId = 'client-test'

describe('repo runtime remote lifecycle', () => {
  beforeEach(() => clearRepoRuntimesForUser(userId))

  test('latest attempt aborts its predecessor and owns the terminal state', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
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
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    expect(listRepoRuntimes(userId)).toEqual([{
      repoRoot,
      repoRuntimeId: runtimeId,
      remoteLifecycle: { kind: 'ready', attemptId: 1, target },
    }])
  })

  test('close aborts the attempt and a reopened generation starts from idle', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    let signal!: AbortSignal
    void runRepoRemoteLifecycle(userId, repoRoot, runtimeId, (nextSignal) => {
      signal = nextSignal
      return new Promise(() => {})
    })
    expect(releaseRepoRuntime(userId, repoRoot, runtimeId, clientId)).toEqual({ released: true, runtimeClosed: true })
    expect(signal.aborted).toBe(true)
    const reopened = acquireRepoRuntime(userId, repoRoot, clientId)
    expect(listRepoRuntimes(userId)).toEqual([{
      repoRoot, repoRuntimeId: reopened, remoteLifecycle: { kind: 'idle', attemptId: 0 },
    }])
  })

  test('bulk user cleanup aborts the attempt and settles it as stale runtime', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    let signal!: AbortSignal
    const transitions: string[] = []
    const work = runRepoRemoteLifecycle(
      userId,
      repoRoot,
      runtimeId,
      (nextSignal) => {
        signal = nextSignal
        return new Promise((_resolve, reject) => {
          nextSignal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        })
      },
      (lifecycle) => transitions.push(`${lifecycle.kind}:${lifecycle.attemptId}`),
    )

    clearRepoRuntimesForUser(userId)

    expect(signal.aborted).toBe(true)
    await expect(work).resolves.toEqual({ kind: 'stale-runtime' })
    expect(transitions).toEqual(['connecting:1'])
    expect(listRepoRuntimes(userId)).toEqual([])
  })

  test('acquire starts a fresh lifecycle epoch after the last release', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    expect(releaseRepoRuntime(userId, repoRoot, runtimeId, clientId)).toEqual({ released: true, runtimeClosed: true })

    const reopened = acquireRepoRuntime(userId, repoRoot, clientId)

    expect(reopened).not.toBe(runtimeId)
    expect(listRepoRuntimes(userId)).toEqual([
      { repoRoot, repoRuntimeId: reopened, remoteLifecycle: { kind: 'idle', attemptId: 0 } },
    ])
  })

  test('normalizes an aborted predecessor rejection to a superseded result', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    const first = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      }),
    )
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready)
    await expect(first).resolves.toEqual({ kind: 'superseded' })
  })

  test('settles a current unexpected failure instead of orphaning connecting', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    await expect(
      runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => { throw new Error('transport failed') }),
    ).resolves.toEqual({ kind: 'settled', lifecycle: { kind: 'failed', attemptId: 1, reason: 'unknown' } })
    expect(listRepoRuntimes(userId)[0]?.remoteLifecycle).toEqual({
      kind: 'failed', attemptId: 1, reason: 'unknown',
    })
  })

  test('returns stale-runtime when close replaces the running generation', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    let release!: (value: RemoteRepoConnectionResult) => void
    const work = runRepoRemoteLifecycle(userId, repoRoot, runtimeId, () =>
      new Promise((resolve) => { release = resolve }),
    )
    releaseRepoRuntime(userId, repoRoot, runtimeId, clientId)
    acquireRepoRuntime(userId, repoRoot, clientId)
    release(ready)
    await expect(work).resolves.toEqual({ kind: 'stale-runtime' })
  })

  test('publishes only accepted connecting and terminal transitions', async () => {
    const runtimeId = acquireRepoRuntime(userId, repoRoot, clientId)
    const transitions: string[] = []
    await runRepoRemoteLifecycle(userId, repoRoot, runtimeId, async () => ready, (lifecycle) => {
      transitions.push(`${lifecycle.kind}:${lifecycle.attemptId}`)
    })
    expect(transitions).toEqual(['connecting:1', 'ready:1'])
  })
})
