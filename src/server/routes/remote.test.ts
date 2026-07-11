import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRemoteRoutes } from '#/server/routes/remote.ts'
import { acquireRepoRuntime, clearRepoRuntimesForUser, releaseRepoRuntime } from '#/server/modules/repo-runtimes.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => ({
  resolveConnection: vi.fn(),
  publishInvalidation: vi.fn(),
}))

vi.mock('#/server/common/identity.ts', () => ({ userIdFromContext: () => 'user-test' }))
vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishUserRepoQueryInvalidation: mocks.publishInvalidation,
}))
vi.mock('#/server/modules/remote.ts', () => ({
  resolveServerRemoteRepoConnection: mocks.resolveConnection,
  getServerRemotePathSuggestions: vi.fn(),
  getServerSshHosts: vi.fn(),
  openServerRemoteEditor: vi.fn(),
  openServerRemoteTerminal: vi.fn(),
  resolveServerRemoteTarget: vi.fn(),
  testServerRemoteRepo: vi.fn(),
}))

describe('remote lifecycle route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRepoRuntimesForUser('user-test')
  })

  test('commands the runtime aggregate and invalidates connecting and terminal projections', async () => {
    const repoId = 'ssh-config://example/repo'
    const repoRuntimeId = acquireRepoRuntime('user-test', repoId, 'client-test')
    const target = normalizeRemoteTarget({
      alias: 'example', host: 'example.test', user: 'developer', port: 22, remotePath: '/repo',
    })!
    mocks.resolveConnection.mockResolvedValue({
      kind: 'ready', repoId, name: 'repo', lifecycle: { kind: 'ready', target },
    })

    const response = await createRemoteRoutes().request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoId, repoRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      kind: 'settled', repoId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1 },
    })
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(2)
    expect(mocks.publishInvalidation).toHaveBeenNthCalledWith(1, 'user-test', {
      repoId, query: 'remote-lifecycle',
    })
  })

  test('returns superseded instead of 500 when a newer attempt replaces the request', async () => {
    const repoId = 'ssh-config://example/repo'
    const repoRuntimeId = acquireRepoRuntime('user-test', repoId, 'client-test')
    let releaseFirst!: (value: never) => void
    mocks.resolveConnection
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
      .mockResolvedValueOnce({
        kind: 'failed', repoId, name: 'repo', lifecycle: { kind: 'failed', reason: 'unreachable' },
      })
    const request = () => createRemoteRoutes().request(new Request('http://localhost/lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId, repoRuntimeId }),
    }))

    const first = request()
    await vi.waitFor(() => expect(mocks.resolveConnection).toHaveBeenCalledTimes(1))
    const second = await request()
    releaseFirst(undefined as never)

    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ kind: 'settled' })
    const firstResponse = await first
    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toMatchObject({ kind: 'superseded', repoId })
  })

  test('returns stale-runtime instead of 500 for a closed generation', async () => {
    const repoId = 'ssh-config://example/repo'
    const staleRuntimeId = acquireRepoRuntime('user-test', repoId, 'client-test')
    releaseRepoRuntime('user-test', repoId, staleRuntimeId, 'client-test')
    acquireRepoRuntime('user-test', repoId, 'client-test')
    const response = await createRemoteRoutes().request(new Request('http://localhost/lifecycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId, repoRuntimeId: staleRuntimeId }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: 'stale-runtime', repoId })
    expect(mocks.resolveConnection).not.toHaveBeenCalled()
    expect(mocks.publishInvalidation).not.toHaveBeenCalled()
  })
})
