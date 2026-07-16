import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { acquireRepoRuntime, clearRepoRuntimesForUser } from '#/server/modules/repo-runtimes.ts'
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
