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
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
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
const clientId = 'client-test'
const workspaceId = workspaceIdForTest('goblin+ssh://example/repo')
const remoteTarget = requiredRemoteTarget()

function requiredRemoteTarget() {
  const target = normalizeRemoteTarget({
    alias: 'example',
    host: 'example.test',
    user: 'developer',
    port: 22,
    remotePath: '/repo',
  })
  if (!target) throw new Error('invalid remote target fixture')
  return target
}

function readyConnection(gitAvailable: boolean, gitDiagnostic?: string): RemoteWorkspaceConnectionResult {
  return {
    kind: 'ready',
    lifecycle: { kind: 'ready', target: remoteTarget },
    gitAvailable,
    ...(gitDiagnostic ? { gitDiagnostic } : {}),
  }
}

function createCapabilityCommitGate() {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  return {
    beforeCapabilityCommit: async () => {
      started.resolve()
      await release.promise
    },
    started: started.promise,
    release: release.resolve,
  }
}

describe('remote lifecycle write path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearWorkspaceRuntimesForUser(userId)
  })

  test('orchestrates resolution, runtime transitions, and invalidation', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValue(readyConnection(true))

    await expect(
      runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' }),
    ).resolves.toMatchObject({
      kind: 'settled',
      workspaceId,
      lifecycle: { kind: 'ready', attemptId: 1 },
    })
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(1)
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(2)
    expect(mocks.publishInvalidation).toHaveBeenNthCalledWith(1, userId, {
      workspaceId,
    })
  })

  test('rejects a local workspace before entering the remote lifecycle', async () => {
    const localWorkspaceId = workspaceIdForTest('goblin+file:///workspace')
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, localWorkspaceId, clientId)
    const before = listWorkspaceRuntimes(userId)

    await expect(
      runRemoteWorkspaceLifecycleWrite({
        userId,
        workspaceId: localWorkspaceId,
        workspaceRuntimeId,
        mode: 'restart',
      }),
    ).rejects.toThrow('remote workspace lifecycle requires an SSH workspace id')

    expect(mocks.resolveConnection).not.toHaveBeenCalled()
    expect(mocks.publishInvalidation).not.toHaveBeenCalled()
    expect(listWorkspaceRuntimes(userId)).toEqual(before)
  })

  test('serializes a conclusive Git downgrade through capability cleanup before committing it', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValueOnce(readyConnection(true)).mockResolvedValueOnce(readyConnection(false))
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
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValueOnce(readyConnection(true)).mockResolvedValueOnce(readyConnection(false))
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const capabilityCommit = createCapabilityCommitGate()

    const transition = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: capabilityCommit.beforeCapabilityCommit },
    )
    await capabilityCommit.started

    expect(listWorkspaceRuntimes(userId)[0]).toMatchObject({
      remoteLifecycle: { kind: 'connecting', attemptId: 2 },
      workspaceProbe: { status: 'probing' },
    })
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(3)

    capabilityCommit.release()
    await transition

    expect(listWorkspaceRuntimes(userId)[0]).toMatchObject({
      remoteLifecycle: { kind: 'ready', attemptId: 2 },
      workspaceProbe: { status: 'ready', capabilities: { git: { status: 'unavailable' } } },
    })
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(4)
  })

  test('queues restart and runtime failure behind an in-flight capability commit', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValueOnce(readyConnection(true)).mockResolvedValue(readyConnection(false))
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const capabilityCommit = createCapabilityCommitGate()
    const downgrade = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: capabilityCommit.beforeCapabilityCommit },
    )
    await capabilityCommit.started

    const restart = runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const failure = failRemoteWorkspaceLifecycle({
      userId,
      workspaceId,
      workspaceRuntimeId,
      reason: 'unreachable',
    })
    await flushMicrotasks()
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(2)

    capabilityCommit.release()
    await expect(downgrade).resolves.toMatchObject({ kind: 'settled', lifecycle: { attemptId: 2 } })
    await expect(restart).resolves.toMatchObject({ kind: 'superseded' })
    await expect(failure).resolves.toMatchObject({ kind: 'settled', lifecycle: { kind: 'failed', attemptId: 4 } })
    expect(listWorkspaceRuntimes(userId)[0]).toMatchObject({
      remoteLifecycle: { kind: 'failed', attemptId: 4 },
      workspaceProbe: { status: 'ready', capabilities: { git: { status: 'unavailable' } } },
    })
  })

  test('publishes terminal state before a membership-free runtime closes', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValue(readyConnection(true))
    const terminalSnapshots: unknown[] = []
    mocks.publishInvalidation.mockImplementation(() => {
      terminalSnapshots.push(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle ?? null)
    })
    const capabilityCommit = createCapabilityCommitGate()
    const lifecycle = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: capabilityCommit.beforeCapabilityCommit },
    )
    await capabilityCommit.started
    releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, clientId)
    capabilityCommit.release()

    await expect(lifecycle).resolves.toMatchObject({ kind: 'stale-runtime' })
    expect(terminalSnapshots).toEqual([
      { kind: 'connecting', attemptId: 1 },
      { kind: 'ready', attemptId: 1, target: remoteTarget },
    ])
    expect(listWorkspaceRuntimes(userId)).toEqual([])
  })

  test('serializes initial conclusive non-Git cleanup exactly once', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValue(readyConnection(false))
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
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValueOnce(readyConnection(true)).mockResolvedValueOnce(readyConnection(false))
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
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValue(readyConnection(false, 'Git probe timed out'))

    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })

    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
  })

  test('atomically commits a diagnosed Git downgrade for a readable remote workspace', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection
      .mockResolvedValueOnce(readyConnection(true))
      .mockResolvedValueOnce(readyConnection(false, 'Git probe timed out'))
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const cleanup = vi.fn(async () => {})

    await runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: cleanup },
    )

    expect(cleanup).toHaveBeenCalledOnce()
    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
    expect(listWorkspaceRuntimes(userId)[0]?.remoteLifecycle).toMatchObject({ kind: 'ready', attemptId: 2 })
  })

  test.each([
    ['path-missing', 'error.workspace-path-not-found'],
    ['unreachable', 'error.workspace-transport-unavailable'],
  ] as const)('commits initial remote failure %s as unavailable probe state', async (reason, expected) => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValue({
      kind: 'failed',
      lifecycle: { kind: 'failed', reason },
    })

    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'ensure' })

    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toEqual({ status: 'unavailable', reason: expected })
  })

  test('keeps reopen in the same epoch while a remote capability transition is committing', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValueOnce(readyConnection(true)).mockResolvedValue(readyConnection(false))
    await runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' })
    const capabilityCommit = createCapabilityCommitGate()
    const transition = runRemoteWorkspaceLifecycleWrite(
      { userId, workspaceId, workspaceRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: capabilityCommit.beforeCapabilityCommit },
    )
    await capabilityCommit.started
    releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, clientId)
    const reopenedRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    capabilityCommit.release()

    await expect(transition).resolves.toMatchObject({ kind: 'settled' })
    expect(reopenedRuntimeId).toBe(workspaceRuntimeId)
    expect(listWorkspaceRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
    })
  })

  test('maps a superseded attempt without leaking runtime internals', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    const firstResult = Promise.withResolvers<RemoteWorkspaceConnectionResult>()
    mocks.resolveConnection
      .mockImplementationOnce(() => firstResult.promise)
      .mockResolvedValueOnce({
        kind: 'failed',
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
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, clientId)
    mocks.resolveConnection.mockResolvedValue(readyConnection(true))
    mocks.publishInvalidation
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, clientId)
      })

    await expect(
      runRemoteWorkspaceLifecycleWrite({ userId, workspaceId, workspaceRuntimeId, mode: 'restart' }),
    ).resolves.toEqual({
      kind: 'stale-runtime',
      workspaceId,
    })
  })
})
