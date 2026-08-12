import {
  createTestRepoRoutes,
  expectRemoteRuntimeFailed,
  openTestWorkspaceRuntime,
  repoRouteMocks,
  resetRepoRouteHarness,
  setRepoRouteTestUserId,
  WORKSPACE_ID,
} from '#/server/test-utils/repo-routes.ts'
import { beforeEach, describe, expect, test } from 'vitest'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { failRemoteWorkspaceLifecycle, runSerializedWorkspaceRefresh } from '#/server/modules/workspace-runtimes.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { RepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'

const mocks = repoRouteMocks()

beforeEach(resetRepoRouteHarness)

describe('repo routes — POST body validation (read endpoints)', () => {
  test('returns 400 for an invalid pull-request scope', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/pull-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId: 'repo-runtime-invalid',
          scope: { kind: 'invalid' },
        }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.readRepoPullRequests).not.toHaveBeenCalled()
  })

  test('rejects Git reads after the server commits Git unavailable', async () => {
    const app = createTestRepoRoutes()
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const workspaceRuntimeId = await openTestWorkspaceRuntime(workspaceId)
    await runSerializedWorkspaceRefresh({
      userId: 'user-test',
      workspaceId: workspaceId,
      workspaceRuntimeId: workspaceRuntimeId,
      probe: async () => ({
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      }),
    })

    const response = await app.request(
      new Request('http://localhost/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: workspaceId, workspaceRuntimeId: workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'error.workspace-git-unavailable' })
    expect(mocks.readRepoSnapshot).not.toHaveBeenCalled()
  })

  test('passes worktree bootstrap preview requests through to the module layer', async () => {
    mocks.getRepoWorktreeBootstrapPreview.mockResolvedValueOnce({
      ok: true,
      preview: {
        hasConfig: false,
        hasOperations: false,
        configHash: null,
        copyCount: 0,
        symlinkCount: 0,
        hardlinkCount: 0,
        excludeCount: 0,
      },
    })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()

    const response = await app.request(
      new Request('http://localhost/worktree-bootstrap-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, preview: { hasOperations: false } })
    expect(mocks.getRepoWorktreeBootstrapPreview).toHaveBeenCalledWith(WORKSPACE_ID, {
      signal: expect.any(AbortSignal),
      workspaceRuntimeId,
    })
  })

  test('passes snapshot body through to the module layer', async () => {
    mocks.readRepoSnapshot.mockResolvedValue({
      snapshot: {
        branches: [],
        current: 'main',
        remote: {
          remotes: [],
          hasRemotes: false,
          hasBrowserRemote: false,
          remoteProviders: {},
          hasGitHubRemote: false,
        },
      },
    })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoSnapshot).toHaveBeenCalledWith(WORKSPACE_ID, {
      signal: expect.any(AbortSignal),
      workspaceRuntimeId,
    })
    expect(await response.json()).toMatchObject({ snapshot: { current: 'main', branches: [] } })
  })

  test('returns a complete repo-runtime-scoped worktree status snapshot', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.readRepoWorktreeStatus.mockResolvedValue({
      workspaceRuntimeId,
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }],
      loadedAt: 123,
    })

    const response = await app.request(
      new Request('http://localhost/worktree-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoWorktreeStatus).toHaveBeenCalledWith(WORKSPACE_ID, {
      signal: expect.any(AbortSignal),
      workspaceRuntimeId,
    })
    expect(await response.json()).toMatchObject({ workspaceRuntimeId, status: [{ path: '/tmp/repo' }] })
  })

  test('returns repo operation state snapshots', async () => {
    mocks.readRepoOperationsSnapshot.mockResolvedValue({
      operations: [
        {
          id: 'repo-op-1',
          repoId: WORKSPACE_ID,
          workspaceRuntimeId: null,
          kind: 'fetch',
          phase: 'running',
          source: 'background',
          target: null,
          queuedAt: 100,
          startedAt: 101,
          deadlineAt: null,
          settledAt: null,
          error: null,
          cancellation: {
            underlyingRequested: false,
            reason: null,
            requestedAt: null,
            waitCancelledCount: 0,
            lastWaitCancelledAt: null,
            lastWaitCancellationReason: null,
          },
          canCancelUnderlying: true,
        },
      ],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, includeSettled: true }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoOperationsSnapshot).toHaveBeenCalledWith(WORKSPACE_ID, {
      includeSettled: true,
      workspaceRuntimeId,
      signal: expect.any(AbortSignal),
    })
    expect(await response.json()).toMatchObject({ operations: [{ kind: 'fetch', phase: 'running' }] })
  })

  test('reads in-memory operations after a remote lifecycle fails', async () => {
    const repoId = workspaceIdForTest('goblin+ssh://remote/workspace')
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime(repoId)
    mocks.readRepoOperationsSnapshot.mockResolvedValueOnce({ operations: [], lastFetchAt: null, loadedAt: 123 })
    await failRemoteWorkspaceLifecycle({
      userId: 'user-test',
      workspaceId: repoId,
      workspaceRuntimeId,
      reason: 'unreachable',
    })

    const response = await app.request(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: repoId, workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoOperationsSnapshot).toHaveBeenCalledWith(repoId, {
      includeSettled: undefined,
      workspaceRuntimeId,
      signal: expect.any(AbortSignal),
    })
  })

  test.each([{}, { cwd: WORKSPACE_ID }, { workspaceRuntimeId: 'workspace-runtime-partial' }])(
    'rejects an incomplete operations runtime scope at the request boundary',
    async (body) => {
      const app = createTestRepoRoutes()
      const response = await app.request(
        new Request('http://localhost/operations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )

      expect(response.status).toBe(400)
      expect(mocks.readRepoOperationsSnapshot).not.toHaveBeenCalled()
    },
  )

  test("does not expose one user's operation scope to another user", async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    setRepoRouteTestUserId('user-other')
    const response = await app.request(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, includeSettled: true }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'error.workspace-runtime-stale' })
    expect(mocks.readRepoOperationsSnapshot).not.toHaveBeenCalled()
  })

  test('passes patch body through to getRepoPatch', async () => {
    mocks.getRepoPatch.mockResolvedValue({ ok: true, message: 'diff --git a b' })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/patch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.getRepoPatch).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/repo/.worktrees/feature', {
      signal: expect.any(AbortSignal),
      workspaceRuntimeId,
    })
  })

  test('hard-fails when repo log reading fails', async () => {
    mocks.getRepoLog.mockRejectedValueOnce(new Error('fatal: bad revision'))
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, branch: 'feature/work', count: 50 }),
      }),
    )

    expect(response.status).toBe(500)
    expect(mocks.getRepoLog).toHaveBeenCalledWith(WORKSPACE_ID, 'feature/work', {
      count: 50,
      skip: 0,
      signal: expect.any(AbortSignal),
      workspaceRuntimeId,
    })
  })

  test('rejects stale runtime-scoped repo reads before the module layer', async () => {
    const app = createTestRepoRoutes()
    await openTestWorkspaceRuntime()

    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-stale', branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.workspace-runtime-stale' })
    expect(mocks.getRepoLog).not.toHaveBeenCalled()
  })

  test('marks remote lifecycle failed when a runtime-scoped repo read hits transport failure', async () => {
    const app = createTestRepoRoutes()
    const repoId = workspaceIdForTest('goblin+ssh://prod/home/alice/service')
    const workspaceRuntimeId = await openTestWorkspaceRuntime(repoId)
    mocks.getRepoLog.mockRejectedValueOnce(
      new RemoteWorkspaceRuntimeFailureError({
        workspaceId: repoId,
        workspaceRuntimeId,
        reason: 'unreachable',
        target: {
          id: repoId,
          alias: 'prod',
          remotePath: '/home/alice/service',
          displayName: 'prod:service',
          host: 'example.test',
          user: 'alice',
          port: 22,
        },
        message: 'connection refused',
      }),
    )

    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: repoId, workspaceRuntimeId, branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.failed-read-repo' })
    expectRemoteRuntimeFailed(repoId, workspaceRuntimeId)
    expect(mocks.publishUserWorkspaceRuntimeInvalidation).toHaveBeenCalledWith('user-test', {
      workspaceId: repoId,
    })
  })

  test.each([
    {
      name: 'worktree-bootstrap-preview',
      path: '/worktree-bootstrap-preview',
      body: (repoId: string, workspaceRuntimeId: string) => ({ cwd: repoId, workspaceRuntimeId }),
      mock: mocks.getRepoWorktreeBootstrapPreview,
    },
    {
      name: 'open-url',
      path: '/open-url',
      body: (repoId: string, workspaceRuntimeId: string) => ({
        cwd: repoId,
        workspaceRuntimeId,
        target: { type: 'branch' as const, branch: 'feature/work' },
      }),
      mock: mocks.openRepoUrl,
    },
  ])('marks remote lifecycle failed when /$name hits transport failure', async ({ path, body, mock }) => {
    const app = createTestRepoRoutes()
    const repoId = workspaceIdForTest('goblin+ssh://prod/home/alice/service')
    const workspaceRuntimeId = await openTestWorkspaceRuntime(repoId)
    mock.mockRejectedValueOnce(
      new RemoteWorkspaceRuntimeFailureError({
        workspaceId: repoId,
        workspaceRuntimeId,
        reason: 'unreachable',
        message: 'connection refused',
      }),
    )

    const response = await app.request(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body(repoId, workspaceRuntimeId)),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.failed-read-repo' })
    expectRemoteRuntimeFailed(repoId, workspaceRuntimeId)
    expect(mocks.publishUserWorkspaceRuntimeInvalidation).toHaveBeenCalledWith('user-test', {
      workspaceId: repoId,
    })
  })

  test('marks remote lifecycle failed when a runtime-scoped repo write hits transport failure', async () => {
    const app = createTestRepoRoutes()
    const repoId = workspaceIdForTest('goblin+ssh://prod/home/alice/service')
    const workspaceRuntimeId = await openTestWorkspaceRuntime(repoId)
    mocks.pullRepoBranch.mockRejectedValueOnce(
      new RemoteWorkspaceRuntimeFailureError({
        workspaceId: repoId,
        workspaceRuntimeId,
        reason: 'unreachable',
        message: 'connection refused',
      }),
    )

    const response = await app.request(
      new Request('http://localhost/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: repoId, workspaceRuntimeId, branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.failed-read-repo' })
    expect(mocks.pullRepoBranch).toHaveBeenCalledWith(
      repoId,
      'feature/work',
      expect.objectContaining({ workspaceId: repoId, workspaceRuntimeId }),
      undefined,
      expect.any(AbortSignal),
    )
    expectRemoteRuntimeFailed(repoId, workspaceRuntimeId)
  })

  test('publishes exact filesystem invalidations for worktrees changed by pull', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const worktreePath = '/tmp/repo-worktree'
    mocks.pullRepoBranch.mockResolvedValueOnce({
      ok: true,
      message: '',
      worktreePathsToInvalidate: [worktreePath, worktreePath],
    })

    const response = await app.request(
      new Request('http://localhost/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          branch: 'feature/work',
          worktreePath,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: '' })
    expect(mocks.publishUserWorkspaceFilesystemInvalidation).toHaveBeenCalledOnce()
    expect(mocks.publishUserWorkspaceFilesystemInvalidation).toHaveBeenCalledWith('user-test', {
      target: {
        kind: 'git-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId,
        root: workspaceIdForTest('goblin+file:///tmp/repo-worktree'),
      },
    })
  })

  test('settles runtime failure before publishing repository and filesystem impact', async () => {
    const app = createTestRepoRoutes()
    const repoId = workspaceIdForTest('goblin+ssh://prod/home/example/service')
    const workspaceRuntimeId = await openTestWorkspaceRuntime(repoId)
    const worktreePath = '/home/example/service-worktree'
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: repoId,
      workspaceRuntimeId,
      reason: 'unreachable',
      message: 'connection lost',
    })
    mocks.pullRepoBranch.mockRejectedValueOnce(
      new RepoMutationRuntimeFailureError(
        {
          ok: false,
          message: 'connection lost',
          repoIdsToInvalidate: [repoId],
          worktreePathsToInvalidate: [worktreePath],
        },
        runtimeFailure,
      ),
    )

    const response = await app.request(
      new Request('http://localhost/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: repoId, workspaceRuntimeId, branch: 'feature/work', worktreePath }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: false, message: 'connection lost' })
    expect(mocks.publishUserWorkspaceFilesystemInvalidation).toHaveBeenCalledWith('user-test', {
      target: {
        kind: 'git-worktree',
        workspaceId: repoId,
        workspaceRuntimeId,
        root: workspaceIdForTest('goblin+ssh://prod/home/example/service-worktree'),
      },
    })
    const lifecycleCall = mocks.publishUserWorkspaceRuntimeInvalidation.mock.invocationCallOrder[0]
    const repositoryCall = mocks.publishRepoReadInvalidation.mock.invocationCallOrder[0]
    const filesystemCall = mocks.publishUserWorkspaceFilesystemInvalidation.mock.invocationCallOrder[0]
    expect(lifecycleCall).toBeLessThan(repositoryCall!)
    expect(repositoryCall).toBeLessThan(filesystemCall!)
  })

  test('publishes filesystem invalidation when a failed pull command may have changed a worktree', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const worktreePath = '/tmp/repo-worktree'
    mocks.pullRepoBranch.mockResolvedValueOnce({
      ok: false,
      message: 'pull failed',
      worktreePathsToInvalidate: [worktreePath],
    })

    const response = await app.request(
      new Request('http://localhost/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          branch: 'feature/work',
          worktreePath,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: 'pull failed',
    })
    expect(mocks.publishUserWorkspaceFilesystemInvalidation).toHaveBeenCalledWith('user-test', {
      target: {
        kind: 'git-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId,
        root: workspaceIdForTest('goblin+file:///tmp/repo-worktree'),
      },
    })
  })

  test('returns 400 when count is below the minimum (1)', async () => {
    // Body schema is `v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))`
    // — POST body has no string coercion, so a wrong type also 400s.
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-test', branch: 'main', count: 0 }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  test('returns 400 when count is a non-integer number', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId: 'repo-runtime-test',
          branch: 'main',
          count: 2.5,
        }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  test('returns 400 when count is not a number', async () => {
    // Query-string mode coerced strings to numbers; POST body doesn't,
    // so this is a new boundary the migration introduces.
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId: 'repo-runtime-test',
          branch: 'main',
          count: '50',
        }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })
})

describe('repo routes — worktree mutation responses', () => {
  test('returns the committed create result without a snapshot read-back', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.createRepoWorktree.mockResolvedValueOnce({ ok: true, message: 'created' })

    const response = await app.request(
      new Request('http://localhost/create-worktree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          worktreePath: '/tmp/repo-feature',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
          worktreeBootstrap: { kind: 'skip' },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: 'created' })
    expect(mocks.readRepoSnapshot).not.toHaveBeenCalled()
  })

  test('does not read a snapshot after a failed create', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.createRepoWorktree.mockResolvedValueOnce({ ok: false, message: 'create failed' })

    const response = await app.request(
      new Request('http://localhost/create-worktree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          worktreePath: '/tmp/repo-feature',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
          worktreeBootstrap: { kind: 'skip' },
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({ ok: false, message: 'create failed' })
    expect(mocks.readRepoSnapshot).not.toHaveBeenCalled()
  })

  test('returns the committed remove result without a snapshot read-back', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    mocks.removeCapturedRepoWorktree.mockResolvedValueOnce({ ok: true, message: 'removed' })

    const response = await app.request(
      new Request('http://localhost/remove-worktree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          workspaceRuntimeId,
          branch: 'feature/a',
          worktreePath: '/tmp/repo-feature',
          deleteBranch: false,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: 'removed' })
    expect(mocks.readRepoSnapshot).not.toHaveBeenCalled()
  })
})
