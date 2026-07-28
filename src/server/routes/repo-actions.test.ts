import {
  CLIENT_ID,
  createTestRepoRoutes,
  openTestWorkspaceRuntime,
  repoRouteMocks,
  resetRepoRouteHarness,
  WORKSPACE_ID,
} from '#/server/test-utils/repo-routes.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RepositoryBoundaryUnavailableError } from '#/server/modules/repository-boundary-error.ts'
import type { createRepoRoutes } from '#/server/routes/repo.ts'
import {
  acquireWorkspaceRuntime,
  commitWorkspaceProbeState,
  releaseWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = repoRouteMocks()

beforeEach(resetRepoRouteHarness)

describe('repo routes — POST body validation (action endpoints)', () => {
  test('admits only canonical WorkspaceIds into background Git sync', async () => {
    const app = createTestRepoRoutes()
    mocks.getBackgroundSyncRepos.mockReturnValue([WORKSPACE_ID])
    mocks.getServerFetchIntervalSec.mockResolvedValue(30)

    const accepted = await app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          revision: 1,
          targets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId: await openTestWorkspaceRuntime() }],
        }),
      }),
    )
    const rejected = await app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          revision: 1,
          targets: [{ workspaceId: '/tmp/workspace', workspaceRuntimeId: 'workspace-runtime-test' }],
        }),
      }),
    )

    expect(accepted.status).toBe(200)
    expect(mocks.commitBackgroundSyncRegistration).toHaveBeenCalledOnce()
    expect(mocks.beginBackgroundSyncRegistration).toHaveBeenCalledWith('user-test', CLIENT_ID, 1, [
      { workspaceId: WORKSPACE_ID, workspaceRuntimeId: expect.stringMatching(/^workspace-runtime-/) },
    ])
    expect(mocks.commitBackgroundSyncRegistration).toHaveBeenCalledWith(
      mocks.beginBackgroundSyncRegistration.mock.results[0]?.value,
    )
    expect(rejected.status).toBe(400)
  })

  test('rejects background sync without a current remote-backed Git runtime', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.getBackgroundSyncSnapshot.mockResolvedValueOnce({ remote: { hasRemotes: false } })

    const localOnly = await app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          revision: 1,
          targets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId }],
        }),
      }),
    )
    const stale = await app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          revision: 1,
          targets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-stale' }],
        }),
      }),
    )

    expect(localOnly.status).toBe(400)
    expect(stale.status).toBe(400)
    await expect(stale.json()).resolves.toMatchObject({ message: 'error.workspace-runtime-stale' })
    expect(mocks.commitBackgroundSyncRegistration).not.toHaveBeenCalled()
  })

  test('rejects background sync for a plain Workspace runtime', async () => {
    const app = createTestRepoRoutes()
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const clientId = 'client-background-sync-test'
    const workspaceRuntimeId = acquireWorkspaceRuntime('user-test', workspaceId, clientId)
    commitWorkspaceProbeState({
      userId: 'user-test',
      workspaceId,
      workspaceRuntimeId,
      probe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })

    const response = await app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, revision: 1, targets: [{ workspaceId, workspaceRuntimeId }] }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.commitBackgroundSyncRegistration).not.toHaveBeenCalled()
  })

  test('does not register a runtime that closes while background sync prepares', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const prepare = { finish: null as (() => void) | null }
    mocks.prepareBackgroundSync.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          prepare.finish = resolve
        }),
    )

    const responsePromise = app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          revision: 1,
          targets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId }],
        }),
      }),
    )
    await vi.waitFor(() => expect(mocks.prepareBackgroundSync).toHaveBeenCalledOnce())
    releaseWorkspaceRuntime('user-test', WORKSPACE_ID, workspaceRuntimeId, CLIENT_ID)
    prepare.finish?.()

    const response = await responsePromise
    expect(response.status).toBe(400)
    expect(mocks.commitBackgroundSyncRegistration).not.toHaveBeenCalled()
  })

  test('does not run admission work for an older client revision', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.beginBackgroundSyncRegistration.mockReturnValueOnce(null)

    const response = await app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          revision: 1,
          targets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId }],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.prepareBackgroundSync).not.toHaveBeenCalled()
    expect(mocks.getBackgroundSyncSnapshot).not.toHaveBeenCalled()
    expect(mocks.commitBackgroundSyncRegistration).not.toHaveBeenCalled()
  })

  test('does not commit an empty registration after its HTTP request is cancelled', async () => {
    const app = createTestRepoRoutes()
    await openTestWorkspaceRuntime()
    const prepare = Promise.withResolvers<void>()
    mocks.prepareBackgroundSync.mockReturnValueOnce(prepare.promise)
    const controller = new AbortController()
    const responsePromise = app.request(
      new Request('http://localhost/background-sync-repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: CLIENT_ID, revision: 1, targets: [] }),
        signal: controller.signal,
      }),
    )
    await vi.waitFor(() => expect(mocks.prepareBackgroundSync).toHaveBeenCalledOnce())

    controller.abort('superseded')
    prepare.resolve()
    await Promise.resolve(responsePromise).catch(() => null)

    expect(mocks.commitBackgroundSyncRegistration).not.toHaveBeenCalled()
  })

  test('returns 400 when fetch body includes caller-controlled operation kind', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, kind: 'background' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.fetchRepo).not.toHaveBeenCalled()
  })

  test('returns 400 when the POST body is empty', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      }),
    )
    expect(response.status).toBe(400)
  })

  test('returns 400 when the POST body is malformed JSON', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(response.status).toBe(400)
  })

  test('fetch route forwards the request abort signal', async () => {
    mocks.fetchRepo.mockResolvedValue({ ok: true, message: 'ok' })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.fetchRepo).toHaveBeenCalledWith(WORKSPACE_ID, 'user', expect.any(AbortSignal), workspaceRuntimeId)
  })

  test('returns a stable repository boundary error from writes', async () => {
    mocks.fetchRepo.mockRejectedValueOnce(new RepositoryBoundaryUnavailableError())
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()

    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.repository-boundary-unavailable',
    })
  })

  test('clone route forwards url/parentPath/directoryName and the request abort signal', async () => {
    mocks.cloneRepo.mockResolvedValue({ ok: true, message: 'ok', path: '/tmp/repo' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/clone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/r.git',
          parentPath: '/tmp',
          directoryName: 'r',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.cloneRepo).toHaveBeenCalledWith('https://example.com/r.git', '/tmp', 'r', expect.any(AbortSignal))
  })

  test('does not disguise an unexpected clone failure as a successful HTTP response', async () => {
    mocks.cloneRepo.mockRejectedValueOnce(new Error('clone boundary failed'))
    const app = createTestRepoRoutes()

    const response = await app.request(
      new Request('http://localhost/clone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/r.git', parentPath: '/tmp', directoryName: 'r' }),
      }),
    )

    expect(response.status).toBe(500)
  })

  test('remove-worktree delegates one composed command and passes cleanup into the repository mutation boundary', async () => {
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const worktreeRemovalApplication: Parameters<typeof createRepoRoutes>[0]['worktreeRemovalApplication'] = {
      removeWorktree: vi.fn(
        async (_userId, input) =>
          await input.remove(
            testPhysicalWorktreeExecutionCapability('/tmp/repo-remove'),
            {
              beforeRemove,
              afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
            },
            new AbortController().signal,
          ),
      ),
    }
    mocks.removeCapturedRepoWorktree.mockImplementationOnce(async (_cwd, _input, lifecycle) => {
      const prepared = await lifecycle.beforeRemove()
      return prepared.ok ? { ok: true, message: 'removed' } : prepared
    })
    const app = createTestRepoRoutes(worktreeRemovalApplication)
    const workspaceRuntimeId = await openTestWorkspaceRuntime(WORKSPACE_ID)
    const response = await app.request(
      new Request('http://localhost/remove-worktree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          branch: 'feature/remove',
          worktreePath: '/tmp/repo-remove',
          deleteBranch: false,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, message: 'removed' })
    expect(mocks.readRepoSnapshot).not.toHaveBeenCalled()
    expect(worktreeRemovalApplication.removeWorktree).toHaveBeenCalledWith(
      'user-test',
      expect.objectContaining({
        repoRoot: WORKSPACE_ID,
        workspaceRuntimeId,
        worktreePath: '/tmp/repo-remove',
      }),
    )
    expect(beforeRemove).toHaveBeenCalledOnce()
    expect(mocks.removeCapturedRepoWorktree).toHaveBeenCalledWith(
      WORKSPACE_ID,
      {
        branch: 'feature/remove',
        worktreePath: '/tmp/repo-remove',
        deleteBranch: false,
        forceDeleteBranch: undefined,
        deleteUpstream: undefined,
      },
      {
        beforeRemove: expect.any(Function),
        afterWorktreeRemoved: expect.any(Function),
      },
      expect.objectContaining({
        identity: expect.objectContaining({
          kind: 'local',
          endpoint: '/tmp/repo-remove',
        }),
      }),
      expect.any(AbortSignal),
      { workspaceRuntimeId },
    )
  })

  test('returns a stable repository boundary error from captured worktree removal', async () => {
    const worktreeRemovalApplication: Parameters<typeof createRepoRoutes>[0]['worktreeRemovalApplication'] = {
      removeWorktree: vi.fn(async (_userId, input) => {
        return await input.remove(
          testPhysicalWorktreeExecutionCapability('/tmp/repo-remove'),
          {
            beforeRemove: async () => ({ ok: true, message: '' }),
            afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
          },
          new AbortController().signal,
        )
      }),
    }
    mocks.removeCapturedRepoWorktree.mockRejectedValueOnce(new RepositoryBoundaryUnavailableError())
    const app = createTestRepoRoutes(worktreeRemovalApplication)
    const workspaceRuntimeId = await openTestWorkspaceRuntime()

    const response = await app.request(
      new Request('http://localhost/remove-worktree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          branch: 'feature/remove',
          worktreePath: '/tmp/repo-remove',
          deleteBranch: false,
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.repository-boundary-unavailable',
    })
  })

  test('open-url route forwards repo URL targets', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: 'https://github.com/acme/repo/commit/abcdef1' })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/open-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, target: { type: 'commit', hash: 'abcdef1' } }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.openRepoUrl).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { type: 'commit', hash: 'abcdef1' },
      expect.any(AbortSignal),
      { workspaceRuntimeId },
    )
  })

  test('delegates branch deletion to the repo mutation application', async () => {
    const deleteBranch = vi.fn(async (_userId, input) => await input.deleteBranch())
    const app = createTestRepoRoutes(undefined, { deleteBranch })
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.deleteRepoBranch.mockResolvedValueOnce({ ok: true, message: 'ok' })

    const response = await app.request('/delete-branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, branch: 'feature/retired' }),
    })

    expect(response.status).toBe(200)
    expect(deleteBranch).toHaveBeenCalledWith('user-test', {
      repoRoot: WORKSPACE_ID,
      workspaceRuntimeId,
      branchName: 'feature/retired',
      deleteBranch: expect.any(Function),
    })

    mocks.deleteRepoBranch.mockResolvedValueOnce({ ok: false, message: 'delete failed' })
    await app.request('/delete-branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, branch: 'feature/kept' }),
    })
    expect(deleteBranch).toHaveBeenCalledTimes(2)
  })
})
