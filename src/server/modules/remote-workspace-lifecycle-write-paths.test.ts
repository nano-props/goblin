import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runRemoteWorkspaceLifecycleWrite } from '#/server/modules/remote-workspace-lifecycle-write-paths.ts'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  failRemoteWorkspaceLifecycle,
  listWorkspaceRuntimes,
  releaseWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import type { RemoteWorkspaceConnectionResult } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({
  resolveConnection: vi.fn<(...args: unknown[]) => Promise<RemoteWorkspaceConnectionResult>>(),
  publishInvalidation: vi.fn(),
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishUserWorkspaceRuntimeInvalidation: mocks.publishInvalidation,
}))
vi.mock('#/server/modules/remote-workspace.ts', () => ({
  resolveServerRemoteWorkspaceConnection: mocks.resolveConnection,
}))

const userId = 'user-test'
const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')

describe('remote lifecycle write path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearWorkspaceRuntimesForUser(userId)
  })

  test('orchestrates resolution, runtime transitions, and invalidation', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: true,
    })

    await expect(
      runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' }),
    ).resolves.toMatchObject({
      kind: 'settled',
      workspaceId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 1 },
    })
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(1)
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(2)
    expect(mocks.publishInvalidation).toHaveBeenNthCalledWith(1, userId, {
      workspaceId,
    })
  })

  test('serializes a conclusive Git downgrade through capability cleanup before committing it', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const cleanup = vi.fn(async ({ before, after }) => {
      expect(before).toMatchObject({ capabilities: { git: { status: 'available' } } })
      expect(after).toMatchObject({ capabilities: { git: { status: 'unavailable' } } })
    })

    await runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: cleanup },
    )

    expect(cleanup).toHaveBeenCalledOnce()
    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      capabilities: { git: { status: 'unavailable' } },
    })
  })

  test('exposes no terminal lifecycle until its capability transition commits', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()

    const transition = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      {
        beforeCapabilityCommit: async () => {
          cleanupStarted.resolve()
          await cleanupGate.promise
        },
      },
    )
    await cleanupStarted.promise

    expect(listWorkspaceRuntimes(userId)[0]).toMatchObject({
      remoteLifecycle: { kind: 'connecting', attemptId: 2 },
      workspaceProbe: { status: 'probing' },
    })
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(3)

    cleanupGate.resolve()
    await transition

    expect(listWorkspaceRuntimes(userId)[0]).toMatchObject({
      remoteLifecycle: { kind: 'ready', attemptId: 2 },
      workspaceProbe: { status: 'ready', capabilities: { git: { status: 'unavailable' } } },
    })
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(4)
  })

  test('queues restart and runtime failure behind an in-flight capability commit', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValue({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()
    const downgrade = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      {
        beforeCapabilityCommit: async () => {
          cleanupStarted.resolve()
          await cleanupGate.promise
        },
      },
    )
    await cleanupStarted.promise

    const restart = runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const failure = failRemoteWorkspaceLifecycle({
      userId,
      workspaceId,
      workspaceRuntimeId,
      reason: 'unreachable',
    })
    await Promise.resolve()
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(2)

    cleanupGate.resolve()
    await expect(downgrade).resolves.toMatchObject({ kind: 'settled', lifecycle: { attemptId: 2 } })
    await expect(restart).resolves.toMatchObject({ kind: 'superseded' })
    await expect(failure).resolves.toMatchObject({ kind: 'settled', lifecycle: { kind: 'failed', attemptId: 4 } })
    expect(listWorkspaceRuntimes(userId)[0]).toMatchObject({
      remoteLifecycle: { kind: 'failed', attemptId: 4 },
      workspaceProbe: { status: 'ready', capabilities: { git: { status: 'unavailable' } } },
    })
  })

  test('publishes terminal state before a membership-free runtime closes', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: true,
    })
    const terminalSnapshots: unknown[] = []
    mocks.publishInvalidation.mockImplementation(() => {
      terminalSnapshots.push(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle ?? null)
    })
    const commitStarted = Promise.withResolvers<void>()
    const commitGate = Promise.withResolvers<void>()
    const lifecycle = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      {
        beforeCapabilityCommit: async () => {
          commitStarted.resolve()
          await commitGate.promise
        },
      },
    )
    await commitStarted.promise
    releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, 'client-test')
    commitGate.resolve()

    await expect(lifecycle).resolves.toMatchObject({ kind: 'stale-runtime' })
    expect(terminalSnapshots).toEqual([
      { kind: 'connecting', attemptId: 1 },
      { kind: 'ready', attemptId: 1, target },
    ])
    expect(listWorkspaceRuntimes(userId)).toEqual([])
  })

  test('serializes initial conclusive non-Git cleanup exactly once', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: false,
    })
    const cleanup = vi.fn(async ({ before, after }) => {
      expect(before).toEqual({ status: 'probing' })
      expect(after).toMatchObject({ capabilities: { git: { status: 'unavailable' } }, diagnostics: [] })
    })

    await runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: cleanup },
    )

    expect(cleanup).toHaveBeenCalledOnce()
  })

  test('rejects a later Git downgrade when no transactional cleanup dependency was injected', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })

    await expect(
      runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' }),
    ).rejects.toThrow('workspace capability downgrade requires transactional cleanup')
    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      capabilities: { git: { status: 'available' } },
    })
    expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toMatchObject({ kind: 'ready', attemptId: 1 })
  })

  test('commits an initial readable workspace when Git enrichment is operationally unavailable', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: false,
      gitDiagnostic: 'Git probe timed out',
    })

    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })

    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
  })

  test.each([
    ['path-missing', 'error.workspace-path-not-found'],
    ['unreachable', 'error.workspace-transport-unavailable'],
  ] as const)('commits initial remote failure %s as unavailable probe state', async (reason, expected) => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    mocks.resolveConnection.mockResolvedValue({
      kind: 'failed',
      name: 'repo',
      lifecycle: { kind: 'failed', reason },
    })

    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'ensure' })

    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toEqual({ status: 'unavailable', reason: expected })
  })

  test('keeps reopen in the same epoch while a remote capability transition is committing', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection
      .mockResolvedValueOnce({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValue({
        kind: 'ready',
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()
    const transition = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      {
        beforeCapabilityCommit: async () => {
          cleanupStarted.resolve()
          await cleanupGate.promise
        },
      },
    )
    await cleanupStarted.promise
    releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, 'client-test')
    const reopenedRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    cleanupGate.resolve()

    await expect(transition).resolves.toMatchObject({ kind: 'settled' })
    expect(reopenedRuntimeId).toBe(workspaceRuntimeId)
    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
    })
  })

  test('maps a superseded attempt without leaking runtime internals', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const firstResult = Promise.withResolvers<RemoteWorkspaceConnectionResult>()
    mocks.resolveConnection
      .mockImplementationOnce(() => firstResult.promise)
      .mockResolvedValueOnce({
        kind: 'failed',
        name: 'repo',
        lifecycle: { kind: 'failed', reason: 'unreachable' },
      })
    const first = runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    await vi.waitFor(() => expect(mocks.resolveConnection).toHaveBeenCalledTimes(1))

    await expect(
      runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' }),
    ).resolves.toMatchObject({
      kind: 'settled',
    })
    firstResult.resolve({
      kind: 'failed',
      name: 'repo',
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })

    await expect(first).resolves.toEqual({ kind: 'superseded', workspaceId })
  })

  test('returns stale-runtime without resolving or invalidating', async () => {
    await expect(
      runRemoteWorkspaceLifecycleWrite({
        userId,
        workspaceId,
        workspaceRuntimeId: 'repo-runtime-stale',
        mode: 'ensure',
      }),
    ).resolves.toEqual({ kind: 'stale-runtime', workspaceId })
    expect(mocks.resolveConnection).not.toHaveBeenCalled()
    expect(mocks.publishInvalidation).not.toHaveBeenCalled()
  })

  test('does not publish a settled lifecycle after its runtime epoch closes', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: true,
    })
    mocks.publishInvalidation
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, 'client-test')
      })

    await expect(
      runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' }),
    ).resolves.toEqual({
      kind: 'stale-runtime',
      workspaceId,
    })
  })
})
