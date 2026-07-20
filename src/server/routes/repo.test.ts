import { beforeEach, describe, expect, test, vi } from 'vitest'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  commitWorkspaceProbeState,
  listWorkspaceRuntimes,
  releaseWorkspaceRuntime,
  runSerializedWorkspaceRefresh,
} from '#/server/modules/workspace-runtimes.ts'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/repo')
const CLIENT_ID = 'client-read-test'

const mocks = vi.hoisted(() => ({
  probeLocalWorkspace: vi.fn(),
  probeWorkspace: vi.fn(),
  getRepoLog: vi.fn(),
  getRepoPatch: vi.fn(),
  readRepoProjection: vi.fn(),
  readRepoWorktreeStatus: vi.fn(),
  readRepoOperationsSnapshot: vi.fn(),
  fetchRepo: vi.fn(),
  cloneRepo: vi.fn(),
  pullRepoBranch: vi.fn(),
  pushRepoBranch: vi.fn(),
  createRepoWorktree: vi.fn(),
  getRepoWorktreeBootstrapPreview: vi.fn(),
  deleteRepoBranch: vi.fn(),
  removeCapturedRepoWorktree: vi.fn(),
  openRepoUrl: vi.fn(),
  beginBackgroundSyncRegistration: vi.fn(),
  commitBackgroundSyncRegistration: vi.fn(),
  finishBackgroundSyncRegistration: vi.fn(),
  prepareBackgroundSync: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  publishRepoQueryInvalidation: vi.fn(),
  publishUserWorkspaceFilesystemInvalidation: vi.fn(),
  publishUserWorkspaceRuntimeInvalidation: vi.fn(),
  getBackgroundSyncSnapshot: vi.fn(),
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  beginBackgroundSyncRegistration: mocks.beginBackgroundSyncRegistration,
  commitBackgroundSyncRegistration: mocks.commitBackgroundSyncRegistration,
  finishBackgroundSyncRegistration: mocks.finishBackgroundSyncRegistration,
  prepareBackgroundSync: mocks.prepareBackgroundSync,
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  getBackgroundSyncDiagnostics: vi.fn(),
}))
vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  getRepoLog: mocks.getRepoLog,
  getRepoPatch: mocks.getRepoPatch,
  readRepoProjection: mocks.readRepoProjection,
  readRepoWorktreeStatus: mocks.readRepoWorktreeStatus,
  readRepoOperationsSnapshot: mocks.readRepoOperationsSnapshot,
  getRepoWorktreeBootstrapPreview: mocks.getRepoWorktreeBootstrapPreview,
}))
vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeLocalWorkspace: mocks.probeLocalWorkspace,
  probeWorkspace: mocks.probeWorkspace,
}))
vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  cloneRepo: mocks.cloneRepo,
  pullRepoBranch: mocks.pullRepoBranch,
  pushRepoBranch: mocks.pushRepoBranch,
  createRepoWorktree: mocks.createRepoWorktree,
  deleteRepoBranch: mocks.deleteRepoBranch,
  removeCapturedRepoWorktree: mocks.removeCapturedRepoWorktree,
  fetchRepo: mocks.fetchRepo,
  openRepoUrl: mocks.openRepoUrl,
}))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
}))
vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: mocks.publishRepoQueryInvalidation,
  publishUserWorkspaceFilesystemInvalidation: mocks.publishUserWorkspaceFilesystemInvalidation,
  publishUserWorkspaceRuntimeInvalidation: mocks.publishUserWorkspaceRuntimeInvalidation,
}))
vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRepoSource: vi.fn(async () => ({ getSnapshot: mocks.getBackgroundSyncSnapshot })),
}))
vi.mock('#/server/common/identity.ts', () => ({
  userIdFromContext: () => 'user-test',
}))

beforeEach(() => {
  vi.clearAllMocks()
  clearWorkspaceRuntimesForUser('user-test')
  mocks.probeLocalWorkspace.mockResolvedValue({
    status: 'ready',
    name: 'workspace',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    },
    diagnostics: [],
  })
  mocks.beginBackgroundSyncRegistration.mockImplementation((userId, clientId, revision, targets) => {
    const controller = new AbortController()
    return { userId, clientId, revision, targets, signal: controller.signal }
  })
  mocks.commitBackgroundSyncRegistration.mockReturnValue(true)
  mocks.probeWorkspace.mockImplementation(mocks.probeLocalWorkspace)
  mocks.pullRepoBranch.mockResolvedValue({ ok: true, message: '' })
  mocks.getBackgroundSyncSnapshot.mockResolvedValue({ remote: { hasRemotes: true } })
})

function createTestRepoRoutes(
  worktreeRemovalApplication: Parameters<typeof createRepoRoutes>[0]['worktreeRemovalApplication'] = {
    async removeWorktree(_userId, input) {
      return await input.remove(
        testPhysicalWorktreeExecutionCapability('/repo/worktree'),
        {
          beforeRemove: async () => ({ ok: true, message: '' }),
          afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
          afterRemoveFailed: async () => {},
        },
        new AbortController().signal,
      )
    },
  },
  repoMutationApplication: Parameters<typeof createRepoRoutes>[0]['repoMutationApplication'] = {
    deleteBranch: async (_userId, input) => await input.deleteBranch(),
  },
  workspaceCapabilityTransitionHost: Parameters<typeof createRepoRoutes>[0]['workspaceCapabilityTransitionHost'] = {
    commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
  },
) {
  return createRepoRoutes({
    worktreeRemovalApplication,
    repoMutationApplication,
    workspaceCapabilityTransitionHost,
  })
}

async function openTestWorkspaceRuntime(repoRoot = WORKSPACE_ID): Promise<string> {
  const workspaceRuntimeId = acquireWorkspaceRuntime('user-test', repoRoot, CLIENT_ID)
  commitWorkspaceProbeState({
    userId: 'user-test',
    workspaceId: repoRoot,
    workspaceRuntimeId,
    probe: {
      status: 'ready',
      name: 'repo',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
  return workspaceRuntimeId
}

async function expectRemoteRuntimeFailed(
  _app: ReturnType<typeof createTestRepoRoutes>,
  repoId: string,
  workspaceRuntimeId: string,
): Promise<void> {
  expect(listWorkspaceRuntimes('user-test')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workspaceId: repoId,
        workspaceRuntimeId,
        remoteLifecycle: expect.objectContaining({ kind: 'failed', reason: 'unreachable' }),
      }),
    ]),
  )
}

describe('repo routes — POST body validation (read endpoints)', () => {
  test('returns 400 for invalid picklist values in the body (e.g. projection mode)', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/projection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, mode: 'not-a-mode' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
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
        name: 'plain-workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      }),
    })

    const response = await app.request(
      new Request('http://localhost/projection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: workspaceId, workspaceRuntimeId: workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'error.workspace-git-unavailable' })
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
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

  test('passes projection body through to the module layer', async () => {
    mocks.readRepoProjection.mockResolvedValue({
      snapshot: { branches: [], current: 'main' },
      pullRequests: [],
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 123,
    })
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const response = await app.request(
      new Request('http://localhost/projection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, workspaceRuntimeId, branch: 'feature/a' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoProjection).toHaveBeenCalledWith(WORKSPACE_ID, {
      branch: 'feature/a',
      mode: 'full',
      signal: expect.any(AbortSignal),
      workspaceRuntimeId,
    })
    expect(await response.json()).toMatchObject({ requested: { branch: 'feature/a', pullRequestMode: 'full' } })
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
          workspaceId: WORKSPACE_ID,
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

  test.each([{ cwd: WORKSPACE_ID }, { workspaceRuntimeId: 'workspace-runtime-partial' }])(
    'rejects a partial operations runtime scope at the request boundary',
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

  test('accepts an explicitly unscoped operations request', async () => {
    mocks.readRepoOperationsSnapshot.mockResolvedValue({ operations: [], loadedAt: 123 })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeSettled: true }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoOperationsSnapshot).toHaveBeenCalledWith(undefined, {
      includeSettled: true,
      signal: expect.any(AbortSignal),
    })
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
    await expectRemoteRuntimeFailed(app, repoId, workspaceRuntimeId)
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
    await expectRemoteRuntimeFailed(app, repoId, workspaceRuntimeId)
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
    expect(mocks.pullRepoBranch).toHaveBeenCalledWith(repoId, 'feature/work', undefined, expect.any(AbortSignal), {
      workspaceRuntimeId,
    })
    await expectRemoteRuntimeFailed(app, repoId, workspaceRuntimeId)
  })

  test('publishes exact filesystem invalidations for worktrees changed by pull', async () => {
    const app = createTestRepoRoutes()
    const workspaceRuntimeId = await openTestWorkspaceRuntime()
    const worktreePath = '/tmp/repo-worktree'
    mocks.pullRepoBranch.mockResolvedValueOnce({
      ok: true,
      message: '',
      affectedWorktreePaths: [worktreePath, worktreePath],
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
        name: 'plain-workspace',
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
              afterRemoveFailed: async () => {},
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
        afterRemoveFailed: expect.any(Function),
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
