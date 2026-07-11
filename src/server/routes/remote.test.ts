import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRemoteRoutes } from '#/server/routes/remote.ts'
import { clearRepoRuntimesForUser, openRepoRuntime } from '#/server/modules/repo-runtimes.ts'
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
    const repoRuntimeId = openRepoRuntime('user-test', repoId)
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
    expect(await response.json()).toMatchObject({ repoId, name: 'repo', lifecycle: { kind: 'ready', attemptId: 1 } })
    expect(mocks.publishInvalidation).toHaveBeenCalledTimes(2)
    expect(mocks.publishInvalidation).toHaveBeenNthCalledWith(1, 'user-test', {
      repoId, query: 'repo-runtime',
    })
  })
})
