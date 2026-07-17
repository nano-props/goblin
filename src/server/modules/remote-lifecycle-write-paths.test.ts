import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import {
  acquireRepoRuntime,
  clearRepoRuntimesForUser,
  listRepoRuntimes,
  releaseRepoRuntime,
} from '#/server/modules/repo-runtimes.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import type { RemoteRepoConnectionResult } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => ({
  resolveConnection: vi.fn(),
  publishInvalidation: vi.fn(),
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishUserRepoQueryInvalidation: mocks.publishInvalidation,
}))
vi.mock('#/server/modules/remote.ts', () => ({
  resolveServerRemoteRepoConnection: mocks.resolveConnection,
}))

const userId = 'user-test'
const repoId = 'goblin+ssh://example/repo'

describe('remote lifecycle write path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRepoRuntimesForUser(userId)
  })

  test('orchestrates resolution, runtime transitions, and invalidation', async () => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: true,
    })

    await expect(runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })).resolves.toMatchObject({
      kind: 'settled',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'ready', attemptId: 1 },
    })
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(1)
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(2)
    expect(mocks.publishInvalidation).toHaveBeenNthCalledWith(1, userId, {
      repoId,
      query: 'remote-lifecycle',
    })
  })

  test('serializes a conclusive Git downgrade through capability cleanup before committing it', async () => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
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
        repoId,
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValueOnce({
        kind: 'ready',
        repoId,
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })
    const cleanup = vi.fn(async ({ before, after }) => {
      expect(before).toMatchObject({ capabilities: { git: { status: 'available' } } })
      expect(after).toMatchObject({ capabilities: { git: { status: 'unavailable' } } })
    })

    await runRemoteLifecycleWrite(
      { userId, repoId, repoRuntimeId, mode: 'restart' },
      { beforeCapabilityCommit: cleanup },
    )

    expect(cleanup).toHaveBeenCalledOnce()
    expect(listRepoRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      capabilities: { git: { status: 'unavailable' } },
    })
  })

  test('rejects a later Git downgrade when no transactional cleanup dependency was injected', async () => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
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
        repoId,
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValueOnce({
        kind: 'ready',
        repoId,
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })

    await expect(runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })).rejects.toThrow(
      'workspace capability downgrade requires transactional cleanup',
    )
    expect(listRepoRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      capabilities: { git: { status: 'available' } },
    })
  })

  test('commits an initial readable workspace when Git enrichment is operationally unavailable', async () => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'ready', target },
      gitAvailable: false,
      gitDiagnostic: 'Git probe timed out',
    })

    await runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })

    expect(listRepoRuntimes(userId)[0]?.workspaceProbe).toMatchObject({
      status: 'ready',
      capabilities: { git: { status: 'unavailable' } },
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
  })

  test.each([
    ['path-missing', 'error.workspace-path-not-found'],
    ['unreachable', 'error.workspace-transport-unavailable'],
  ] as const)('commits initial remote failure %s as unavailable probe state', async (reason, expected) => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
    mocks.resolveConnection.mockResolvedValue({
      kind: 'failed',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'failed', reason },
    })

    await runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'ensure' })

    expect(listRepoRuntimes(userId)[0]?.workspaceProbe).toEqual({ status: 'unavailable', reason: expected })
  })

  test('does not let an old remote capability transition commit into a reopened epoch', async () => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
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
        repoId,
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: true,
      })
      .mockResolvedValue({
        kind: 'ready',
        repoId,
        name: 'repo',
        lifecycle: { kind: 'ready', target },
        gitAvailable: false,
      })
    await runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()
    const transition = runRemoteLifecycleWrite(
      { userId, repoId, repoRuntimeId, mode: 'restart' },
      {
        beforeCapabilityCommit: async () => {
          cleanupStarted.resolve()
          await cleanupGate.promise
        },
      },
    )
    await cleanupStarted.promise
    releaseRepoRuntime(userId, repoId, repoRuntimeId, 'client-test')
    const reopenedRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
    cleanupGate.resolve()

    await expect(transition).resolves.toMatchObject({ kind: 'settled' })
    expect(reopenedRuntimeId).not.toBe(repoRuntimeId)
    expect(listRepoRuntimes(userId)[0]?.workspaceProbe).toEqual({ status: 'probing' })
  })

  test('maps a superseded attempt without leaking runtime internals', async () => {
    const repoRuntimeId = acquireRepoRuntime(userId, repoId, 'client-test')
    const firstResult = Promise.withResolvers<RemoteRepoConnectionResult>()
    mocks.resolveConnection
      .mockImplementationOnce(() => firstResult.promise)
      .mockResolvedValueOnce({
        kind: 'failed',
        repoId,
        name: 'repo',
        lifecycle: { kind: 'failed', reason: 'unreachable' },
      })
    const first = runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })
    await vi.waitFor(() => expect(mocks.resolveConnection).toHaveBeenCalledTimes(1))

    await expect(runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId, mode: 'restart' })).resolves.toMatchObject({
      kind: 'settled',
    })
    firstResult.resolve({
      kind: 'failed',
      repoId,
      name: 'repo',
      lifecycle: { kind: 'failed', reason: 'unreachable' },
    })

    await expect(first).resolves.toEqual({ kind: 'superseded', repoId })
  })

  test('returns stale-runtime without resolving or invalidating', async () => {
    await expect(
      runRemoteLifecycleWrite({ userId, repoId, repoRuntimeId: 'repo-runtime-stale', mode: 'ensure' }),
    ).resolves.toEqual({ kind: 'stale-runtime', repoId })
    expect(mocks.resolveConnection).not.toHaveBeenCalled()
    expect(mocks.publishInvalidation).not.toHaveBeenCalled()
  })
})
