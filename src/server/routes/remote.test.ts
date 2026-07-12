import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRemoteRoutes } from '#/server/routes/remote.ts'

const mocks = vi.hoisted(() => ({
  runLifecycleWrite: vi.fn(),
}))

vi.mock('#/server/common/identity.ts', () => ({ userIdFromContext: () => 'user-test' }))
vi.mock('#/server/modules/remote-lifecycle-write-paths.ts', () => ({
  runRemoteLifecycleWrite: mocks.runLifecycleWrite,
}))

describe('remote lifecycle route', () => {
  beforeEach(() => vi.clearAllMocks())

  test('passes authenticated and validated input to the write path', async () => {
    mocks.runLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      repoId: 'ssh-config://example/repo',
      name: 'repo',
      lifecycle: { kind: 'failed', attemptId: 1, reason: 'unreachable' },
    })

    const response = await createRemoteRoutes().request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoId: 'ssh-config://example/repo',
          repoRuntimeId: 'repo-runtime-test',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.runLifecycleWrite).toHaveBeenCalledWith({
      userId: 'user-test',
      repoId: 'ssh-config://example/repo',
      repoRuntimeId: 'repo-runtime-test',
      mode: 'restart',
    })
    expect(await response.json()).toMatchObject({ kind: 'settled', name: 'repo' })
  })

  test('returns validation errors before invoking the write path', async () => {
    const response = await createRemoteRoutes().request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoId: 'ssh-config://example/repo', repoRuntimeId: '' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.runLifecycleWrite).not.toHaveBeenCalled()
  })
})
