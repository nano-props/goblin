import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRemoteRoutes } from '#/server/routes/remote.ts'

const mocks = vi.hoisted(() => ({
  runLifecycleWrite: vi.fn(),
  getServerRemotePathSuggestions: vi.fn(),
}))

vi.mock('#/server/common/identity.ts', () => ({ userIdFromContext: () => 'user-test' }))
vi.mock('#/server/modules/remote-workspace-lifecycle-write-paths.ts', () => ({
  runRemoteWorkspaceLifecycleWrite: mocks.runLifecycleWrite,
}))
vi.mock('#/server/modules/remote-workspace.ts', () => ({
  getServerRemotePathSuggestions: mocks.getServerRemotePathSuggestions,
  getServerSshHosts: vi.fn(),
  resolveServerRemoteTarget: vi.fn(),
  testServerRemoteWorkspace: vi.fn(),
}))
describe('remote lifecycle route', () => {
  beforeEach(() => vi.clearAllMocks())

  test('passes authenticated and validated input to the write path', async () => {
    mocks.runLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      workspaceId: 'goblin+ssh://example/repo',
      name: 'repo',
      lifecycle: { kind: 'failed', attemptId: 1, reason: 'unreachable' },
    })

    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: {
        commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
      },
    }).request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'goblin+ssh://example/repo',
          workspaceRuntimeId: 'repo-runtime-test',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.runLifecycleWrite).toHaveBeenCalledWith(
      {
        userId: 'user-test',
        workspaceId: 'goblin+ssh://example/repo',
        workspaceRuntimeId: 'repo-runtime-test',
        mode: 'restart',
      },
      { beforeCapabilityCommit: expect.any(Function) },
    )
    expect(await response.json()).toMatchObject({ kind: 'settled', name: 'repo' })
  })

  test('uses only alias and prefix for remote directory suggestions', async () => {
    mocks.getServerRemotePathSuggestions.mockResolvedValue(['/srv/repo'])
    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval: vi.fn() },
    }).request(
      new Request('http://localhost/path-suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alias: 'example', prefix: '/srv/re' }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(['/srv/repo'])
    expect(mocks.getServerRemotePathSuggestions).toHaveBeenCalledWith(
      { alias: 'example', prefix: '/srv/re' },
      expect.any(AbortSignal),
    )
  })

  test('injects Git downgrade cleanup into the serialized capability transition', async () => {
    const commitGitCapabilityRemoval = vi.fn(async () => ({ kind: 'committed' as const }))
    mocks.runLifecycleWrite.mockImplementation(async (_input, options) => {
      await options.beforeCapabilityCommit({
        before: {
          status: 'ready',
          name: 'repo',
          diagnostics: [],
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
          },
        },
        after: {
          status: 'ready',
          name: 'repo',
          diagnostics: [],
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
        },
      })
      return { kind: 'settled', workspaceId: 'goblin+ssh://example/repo', name: 'repo', lifecycle: { kind: 'ready' } }
    })

    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval },
    }).request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'goblin+ssh://example/repo', workspaceRuntimeId: 'repo-runtime-test' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(commitGitCapabilityRemoval).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-test',
        workspaceId: 'goblin+ssh://example/repo',
        workspaceRuntimeId: 'repo-runtime-test',
      }),
    )
  })

  test('returns validation errors before invoking the write path', async () => {
    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: {
        commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
      },
    }).request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'goblin+ssh://example/repo', workspaceRuntimeId: '' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.runLifecycleWrite).not.toHaveBeenCalled()
  })

  test('rejects a local workspace before invoking the remote lifecycle write path', async () => {
    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: {
        commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
      },
    }).request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'goblin+file:///workspace',
          workspaceRuntimeId: 'repo-runtime-test',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.runLifecycleWrite).not.toHaveBeenCalled()
  })
})
