import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRemoteRoutes } from '#/server/routes/remote.ts'
import type {
  RunRemoteWorkspaceLifecycleInput,
  RunRemoteWorkspaceLifecycleOptions,
} from '#/server/modules/remote-workspace-lifecycle-write-paths.ts'
import type { RemoteWorkspaceLifecycleCommandResult } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { acquireWorkspaceRuntime, clearWorkspaceRuntimesForUser } from '#/server/modules/workspace-runtimes.ts'

const REMOTE_ID = workspaceIdForTest('goblin+ssh://example/repo')
const USER_ID = 'user-test'
const CLIENT_ID = 'client-test'
let workspaceRuntimeId: string

type RunRemoteWorkspaceLifecycleWrite = (
  input: RunRemoteWorkspaceLifecycleInput,
  options?: RunRemoteWorkspaceLifecycleOptions,
) => Promise<RemoteWorkspaceLifecycleCommandResult>

const mocks = vi.hoisted(() => ({
  runLifecycleWrite: vi.fn<RunRemoteWorkspaceLifecycleWrite>(),
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
  beforeEach(() => {
    vi.clearAllMocks()
    clearWorkspaceRuntimesForUser(USER_ID)
    workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, REMOTE_ID, CLIENT_ID)
  })
  afterEach(() => clearWorkspaceRuntimesForUser(USER_ID))

  test('passes authenticated and validated input to the write path', async () => {
    mocks.runLifecycleWrite.mockResolvedValue({
      kind: 'settled',
      workspaceId: REMOTE_ID,
      lifecycle: { kind: 'failed', attemptId: 1, reason: 'unsupported-platform' },
      workspaceProbe: { status: 'unavailable', reason: 'error.workspace-transport-unavailable' },
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
          workspaceRuntimeId,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.runLifecycleWrite).toHaveBeenCalledWith(
      {
        userId: 'user-test',
        workspaceId: 'goblin+ssh://example/repo',
        workspaceRuntimeId,
        mode: 'restart',
      },
      { beforeCapabilityCommit: expect.any(Function) },
    )
    expect(await response.json()).toMatchObject({
      kind: 'settled',
      lifecycle: { reason: 'unsupported-platform' },
    })
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
      if (!options?.beforeCapabilityCommit) throw new Error('expected capability transition hook')
      await options.beforeCapabilityCommit({
        before: {
          status: 'ready',
          diagnostics: [],
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
          },
        },
        after: {
          status: 'ready',
          diagnostics: [],
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
        },
      })
      return {
        kind: 'settled',
        workspaceId: REMOTE_ID,
        lifecycle: {
          kind: 'ready',
          attemptId: 1,
          target: {
            id: REMOTE_ID,
            alias: 'example',
            remotePath: '/repo',
            displayName: 'example:repo',
            host: 'example.test',
            user: 'developer',
            port: 22,
          },
        },
        workspaceProbe: {
          status: 'ready',
          diagnostics: [],
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
        },
      }
    })

    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval },
    }).request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'goblin+ssh://example/repo', workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(commitGitCapabilityRemoval).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeCapability: expect.objectContaining({
          userId: 'user-test',
          workspaceId: 'goblin+ssh://example/repo',
          workspaceRuntimeId,
        }),
      }),
    )
  })

  test('rejects a stale runtime at the HTTP admission boundary', async () => {
    clearWorkspaceRuntimesForUser(USER_ID)

    const response = await createRemoteRoutes({
      workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval: vi.fn() },
    }).request(
      new Request('http://localhost/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: REMOTE_ID, workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'error.workspace-runtime-stale' })
    expect(mocks.runLifecycleWrite).not.toHaveBeenCalled()
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
