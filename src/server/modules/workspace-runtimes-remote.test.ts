import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  failRemoteWorkspaceLifecycle,
  listWorkspaceRuntimes,
  releaseWorkspaceRuntime,
  runRemoteWorkspaceLifecycle,
} from '#/server/modules/workspace-runtimes.ts'
import type { RemoteWorkspaceConnectionResult, RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const userId = 'user_test'
const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')
const target: RemoteWorkspaceTarget = {
  id: workspaceId,
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/repo',
  displayName: 'example:repo',
}
const ready: RemoteWorkspaceConnectionResult = {
  kind: 'ready',
  name: 'repo',
  gitAvailable: true,
  lifecycle: { kind: 'ready', target },
}
const clientId = 'client-test'

describe('workspace runtime remote lifecycle', () => {
  beforeEach(() => clearWorkspaceRuntimesForUser(userId))

  test('latest attempt aborts its predecessor and owns the terminal state', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    let releaseFirst!: (value: RemoteWorkspaceConnectionResult) => void
    let firstSignal!: AbortSignal
    const first = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, (signal) => {
      firstSignal = signal
      return new Promise((resolve) => {
        releaseFirst = resolve
      })
    })
    await vi.waitFor(() =>
      expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toEqual({ kind: 'connecting', attemptId: 1 }),
    )

    const second = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => ready)
    await vi.waitFor(() => expect(firstSignal.aborted).toBe(true))
    await expect(second).resolves.toMatchObject({ kind: 'settled', lifecycle: { kind: 'ready', attemptId: 2 } })
    releaseFirst(ready)
    await expect(first).resolves.toEqual({ kind: 'superseded' })
    expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toMatchObject({ kind: 'ready', attemptId: 2 })
  })

  test('ensure joins an existing connecting lifecycle without restarting it', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    let firstSignal!: AbortSignal
    let releaseFirst!: (value: RemoteWorkspaceConnectionResult) => void
    const first = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, (signal) => {
      firstSignal = signal
      return new Promise((resolve) => {
        releaseFirst = resolve
      })
    })
    await vi.waitFor(() => expect(firstSignal).toBeDefined())
    const resolver = vi.fn(async () => ready)

    const ensured = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, resolver, () => {}, 'ensure')
    expect(resolver).not.toHaveBeenCalled()
    expect(firstSignal.aborted).toBe(false)
    releaseFirst(ready)
    await expect(first).resolves.toMatchObject({ kind: 'settled', lifecycle: { attemptId: 1 } })
    await expect(ensured).resolves.toMatchObject({ kind: 'settled', name: 'repo', lifecycle: { attemptId: 1 } })
  })

  test('ensure reuses the complete settled projection without resolving again', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    await runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => ready)
    const resolver = vi.fn(async () => ready)

    await expect(
      runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, resolver, () => {}, 'ensure'),
    ).resolves.toMatchObject({ kind: 'settled', name: target.displayName, lifecycle: { kind: 'ready', attemptId: 1 } })
    expect(resolver).not.toHaveBeenCalled()
  })

  test('ensure follows a replacement attempt until the current lifecycle settles', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    const first = Promise.withResolvers<RemoteWorkspaceConnectionResult>()
    const second = Promise.withResolvers<RemoteWorkspaceConnectionResult>()
    let firstSignal!: AbortSignal
    const firstRun = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, (signal) => {
      firstSignal = signal
      return first.promise
    })
    const ensured = runRemoteWorkspaceLifecycle(
      userId,
      workspaceId,
      runtimeId,
      async () => ready,
      () => {},
      'ensure',
    )
    const restarted = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, () => second.promise)
    await vi.waitFor(() => expect(firstSignal.aborted).toBe(true))
    first.resolve(ready)
    await expect(firstRun).resolves.toEqual({ kind: 'superseded' })

    let ensureSettled = false
    void ensured.finally(() => {
      ensureSettled = true
    })
    await Promise.resolve()
    expect(ensureSettled).toBe(false)

    second.resolve(ready)
    await expect(restarted).resolves.toMatchObject({ kind: 'settled', lifecycle: { attemptId: 2 } })
    await expect(ensured).resolves.toMatchObject({ kind: 'settled', lifecycle: { attemptId: 2 } })
  })

  test('publishes lifecycle through the user-scoped runtime snapshot', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    await runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => ready)
    expect(listWorkspaceRuntimes(userId)).toEqual([
      {
        workspaceId,
        workspaceRuntimeId: runtimeId,
        workspaceProbe: { status: 'probing' },
        remoteLifecycle: { kind: 'ready', attemptId: 1, target },
      },
    ])
  })

  test('close aborts the attempt and a reopened generation starts from idle', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    let signal!: AbortSignal
    void runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, (nextSignal) => {
      signal = nextSignal
      return new Promise(() => {})
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(releaseWorkspaceRuntime(userId, workspaceId, runtimeId, clientId)).toEqual({
      released: true,
      runtimeClosed: true,
    })
    expect(signal.aborted).toBe(true)
    const reopened = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    expect(listWorkspaceRuntimes(userId)).toEqual([
      {
        workspaceId,
        workspaceRuntimeId: reopened,
        workspaceProbe: { status: 'probing' },
        remoteLifecycle: { kind: 'idle', attemptId: 0 },
      },
    ])
  })

  test('bulk user cleanup aborts the attempt and settles it as stale runtime', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    let signal!: AbortSignal
    const transitions: string[] = []
    const work = runRemoteWorkspaceLifecycle(
      userId,
      workspaceId,
      runtimeId,
      (nextSignal) => {
        signal = nextSignal
        return new Promise((_resolve, reject) => {
          nextSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      },
      (lifecycle) => transitions.push(`${lifecycle.kind}:${lifecycle.attemptId}`),
    )
    await vi.waitFor(() => expect(signal).toBeDefined())

    clearWorkspaceRuntimesForUser(userId)

    expect(signal.aborted).toBe(true)
    await expect(work).resolves.toEqual({ kind: 'stale-runtime' })
    expect(transitions).toEqual(['connecting:1'])
    expect(listWorkspaceRuntimes(userId)).toEqual([])
  })

  test('acquire starts a fresh lifecycle epoch after the last release', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    await runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => ready)
    expect(releaseWorkspaceRuntime(userId, workspaceId, runtimeId, clientId)).toEqual({
      released: true,
      runtimeClosed: true,
    })

    const reopened = acquireWorkspaceRuntime(userId, workspaceId, clientId)

    expect(reopened).not.toBe(runtimeId)
    expect(listWorkspaceRuntimes(userId)).toEqual([
      {
        workspaceId,
        workspaceRuntimeId: reopened,
        workspaceProbe: { status: 'probing' },
        remoteLifecycle: { kind: 'idle', attemptId: 0 },
      },
    ])
  })

  test('normalizes an aborted predecessor rejection to a superseded result', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    const first = runRemoteWorkspaceLifecycle(
      userId,
      workspaceId,
      runtimeId,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        }),
    )
    await runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => ready)
    await expect(first).resolves.toEqual({ kind: 'superseded' })
  })

  test('settles a current unexpected failure instead of orphaning connecting', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    await expect(
      runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => {
        throw new Error('transport failed')
      }),
    ).resolves.toEqual({
      kind: 'settled',
      name: workspaceId,
      lifecycle: { kind: 'failed', attemptId: 1, reason: 'unknown' },
    })
    expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toEqual({
      kind: 'failed',
      attemptId: 1,
      reason: 'unknown',
    })
  })

  test('returns stale-runtime when close replaces the running generation', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    let release!: (value: RemoteWorkspaceConnectionResult) => void
    const work = runRemoteWorkspaceLifecycle(
      userId,
      workspaceId,
      runtimeId,
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await vi.waitFor(() => expect(release).toBeDefined())
    releaseWorkspaceRuntime(userId, workspaceId, runtimeId, clientId)
    acquireWorkspaceRuntime(userId, workspaceId, clientId)
    release(ready)
    await expect(work).resolves.toEqual({ kind: 'stale-runtime' })
  })

  test('publishes only accepted connecting and terminal transitions', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    const transitions: string[] = []
    await runRemoteWorkspaceLifecycle(
      userId,
      workspaceId,
      runtimeId,
      async () => ready,
      (lifecycle) => {
        transitions.push(`${lifecycle.kind}:${lifecycle.attemptId}`)
      },
    )
    expect(transitions).toEqual(['connecting:1', 'ready:1'])
  })

  test('external failure settles the current remote lifecycle without closing the runtime', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)

    await expect(
      failRemoteWorkspaceLifecycle({
        userId,
        workspaceId,
        workspaceRuntimeId: runtimeId,
        reason: 'unreachable',
        target,
      }),
    ).resolves.toEqual({
      kind: 'settled',
      name: target.displayName,
      lifecycle: { kind: 'failed', attemptId: 1, reason: 'unreachable', target },
    })
    expect(listWorkspaceRuntimes(userId)).toEqual([
      {
        workspaceId,
        workspaceRuntimeId: runtimeId,
        workspaceProbe: { status: 'probing' },
        remoteLifecycle: { kind: 'failed', attemptId: 1, reason: 'unreachable', target },
      },
    ])
    expect(releaseWorkspaceRuntime(userId, workspaceId, runtimeId, clientId)).toEqual({
      released: true,
      runtimeClosed: true,
    })
  })

  test('external failure rejects stale and non-remote runtimes', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)

    await expect(
      failRemoteWorkspaceLifecycle({
        userId,
        workspaceId,
        workspaceRuntimeId: 'workspace-runtime-stale',
        reason: 'timeout',
      }),
    ).resolves.toEqual({ kind: 'stale-runtime' })
    await expect(
      failRemoteWorkspaceLifecycle({
        userId,
        workspaceId: workspaceIdForTest('goblin+file:///local/repo'),
        workspaceRuntimeId: runtimeId,
        reason: 'timeout',
      }),
    ).resolves.toEqual({ kind: 'not-remote' })
  })

  test('external failure aborts a connecting lifecycle and prevents older ready from winning', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    let signal!: AbortSignal
    let release!: (value: RemoteWorkspaceConnectionResult) => void
    const connecting = runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, (nextSignal) => {
      signal = nextSignal
      return new Promise((resolve) => {
        release = resolve
      })
    })
    await vi.waitFor(() =>
      expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toEqual({ kind: 'connecting', attemptId: 1 }),
    )

    await expect(
      failRemoteWorkspaceLifecycle({ userId, workspaceId, workspaceRuntimeId: runtimeId, reason: 'timeout' }),
    ).resolves.toEqual({
      kind: 'settled',
      name: workspaceId,
      lifecycle: { kind: 'failed', attemptId: 2, reason: 'timeout' },
    })
    expect(signal.aborted).toBe(true)
    release(ready)

    await expect(connecting).resolves.toEqual({ kind: 'superseded' })
    expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toEqual({
      kind: 'failed',
      attemptId: 2,
      reason: 'timeout',
    })
  })

  test('external failure preserves the last known remote target', async () => {
    const runtimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    await runRemoteWorkspaceLifecycle(userId, workspaceId, runtimeId, async () => ready)

    await expect(
      failRemoteWorkspaceLifecycle({ userId, workspaceId, workspaceRuntimeId: runtimeId, reason: 'handshake-failed' }),
    ).resolves.toEqual({
      kind: 'settled',
      name: target.displayName,
      lifecycle: { kind: 'failed', attemptId: 2, reason: 'handshake-failed', target },
    })
  })
})
