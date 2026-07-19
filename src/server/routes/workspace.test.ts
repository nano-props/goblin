import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createWorkspaceRoutes } from '#/server/routes/workspace.ts'
import {
  acquireWorkspaceRuntime,
  captureWorkspaceRuntimeMembershipLease,
  clearWorkspaceRuntimesForUser,
  commitWorkspaceProbeState,
  listWorkspaceRuntimes,
} from '#/server/modules/workspace-runtimes.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'

const USER_ID = 'workspace-route-user'
const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/workspace-route')
const CLIENT_ID = 'workspace-route-client'

const mocks = vi.hoisted(() => ({
  probeLocalWorkspace: vi.fn(),
  probeWorkspace: vi.fn(),
  readWorkspaceFilesystemTree: vi.fn(),
  readWorkspaceFileViewer: vi.fn(),
  trashWorkspaceFile: vi.fn(),
  openWorkspaceTerminal: vi.fn(),
  openWorkspaceEditor: vi.fn(),
  openWorkspaceInFinder: vi.fn(),
  publishUserRepoQueryInvalidation: vi.fn(),
  publishUserWorkspaceFilesystemInvalidation: vi.fn(),
  publishUserWorkspaceRuntimeInvalidation: vi.fn(),
}))

vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeLocalWorkspace: mocks.probeLocalWorkspace,
  probeWorkspace: mocks.probeWorkspace,
}))

vi.mock('#/server/modules/workspace-filesystem-tree.ts', () => ({
  readWorkspaceFilesystemTree: mocks.readWorkspaceFilesystemTree,
}))
vi.mock('#/server/modules/workspace-file-viewer.ts', () => ({
  readWorkspaceFileViewer: mocks.readWorkspaceFileViewer,
}))
vi.mock('#/server/modules/workspace-file-trash.ts', () => ({ trashWorkspaceFile: mocks.trashWorkspaceFile }))
vi.mock('#/server/modules/workspace-external-apps.ts', () => ({
  openWorkspaceTerminal: mocks.openWorkspaceTerminal,
  openWorkspaceEditor: mocks.openWorkspaceEditor,
  openWorkspaceInFinder: mocks.openWorkspaceInFinder,
}))
vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishUserRepoQueryInvalidation: mocks.publishUserRepoQueryInvalidation,
  publishUserWorkspaceFilesystemInvalidation: mocks.publishUserWorkspaceFilesystemInvalidation,
  publishUserWorkspaceRuntimeInvalidation: mocks.publishUserWorkspaceRuntimeInvalidation,
}))

vi.mock('#/server/common/identity.ts', () => ({
  userIdFromContext: () => USER_ID,
}))

const readyPlainWorkspace = {
  status: 'ready' as const,
  name: 'workspace-route',
  capabilities: {
    files: { read: true as const, write: true },
    terminal: { available: true },
    git: { status: 'unavailable' as const },
  },
  diagnostics: [],
}

describe('workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearWorkspaceRuntimesForUser(USER_ID)
    mocks.probeLocalWorkspace.mockResolvedValue(readyPlainWorkspace)
    mocks.probeWorkspace.mockResolvedValue(readyPlainWorkspace)
    mocks.readWorkspaceFilesystemTree.mockResolvedValue({ nodes: [], truncated: false })
    mocks.readWorkspaceFileViewer.mockResolvedValue({
      viewer: 'cat',
      shell: 'posix',
      executionRoot: '/tmp/workspace-route',
    })
    mocks.trashWorkspaceFile.mockResolvedValue({ ok: true, message: '' })
    mocks.openWorkspaceTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openWorkspaceEditor.mockResolvedValue({ ok: true, message: '' })
    mocks.openWorkspaceInFinder.mockResolvedValue({ ok: true, message: '' })
  })

  test('opens a command input as one canonical workspace runtime', async () => {
    const commitGitCapabilityRemoval = vi.fn(async () => ({ kind: 'committed' as const }))
    const app = createWorkspaceRoutes({ workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval } })
    const response = await post(app, '/runtime-open', {
      workspaceInput: '/tmp/workspace-route',
      clientId: CLIENT_ID,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      workspace: { id: WORKSPACE_ID, name: 'workspace-route' },
      workspaceRuntimeId: expect.stringMatching(/^workspace-runtime-/),
      capabilities: { git: { status: 'unavailable' } },
    })
    expect(commitGitCapabilityRemoval).toHaveBeenCalledOnce()
    expect(captureWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID).entries).toEqual([
      expect.objectContaining({ workspaceId: WORKSPACE_ID, generation: 1 }),
    ])
  })

  test('rolls back a newly acquired membership when initial capability cleanup fails', async () => {
    const cleanupError = new Error('durable layout write failed')
    const app = createWorkspaceRoutes({
      workspaceCapabilityTransitionHost: {
        commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'failed-before-commit' as const, error: cleanupError })),
      },
    })

    const response = await post(app, '/runtime-open', {
      workspaceInput: '/tmp/workspace-route',
      clientId: CLIENT_ID,
    })

    expect(response.status).toBe(500)
    expect(captureWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID).entries).toEqual([])
    await expect((await post(app, '/runtime-list', {})).json()).resolves.toEqual({ runtimes: [] })
  })

  test('restores an existing membership generation when renewed admission cleanup fails', async () => {
    const workspaceRuntimeId = acquireWorkspaceRuntime(USER_ID, WORKSPACE_ID, CLIENT_ID)
    const before = captureWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID).entries[0]
    const cleanupError = new Error('durable layout write failed')
    const app = createWorkspaceRoutes({
      workspaceCapabilityTransitionHost: {
        commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'failed-before-commit' as const, error: cleanupError })),
      },
    })

    const response = await post(app, '/runtime-open', {
      workspaceInput: '/tmp/workspace-route',
      clientId: CLIENT_ID,
    })

    expect(response.status).toBe(500)
    expect(captureWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID).entries).toEqual([before])
    await expect((await post(app, '/runtime-list', {})).json()).resolves.toMatchObject({
      runtimes: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId }],
    })
  })

  test('serializes failed renewals so a later rollback cannot restore another failed admission', async () => {
    acquireWorkspaceRuntime(USER_ID, WORKSPACE_ID, CLIENT_ID)
    const before = captureWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID).entries[0]
    const cleanupStarted = Promise.withResolvers<void>()
    const cleanupGate = Promise.withResolvers<void>()
    const commitGitCapabilityRemoval = vi
      .fn()
      .mockImplementationOnce(async () => {
        cleanupStarted.resolve()
        await cleanupGate.promise
        return { kind: 'failed-before-commit' as const, error: new Error('first cleanup failed') }
      })
      .mockResolvedValueOnce({ kind: 'failed-before-commit' as const, error: new Error('second cleanup failed') })
    const app = createWorkspaceRoutes({ workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval } })

    const first = post(app, '/runtime-open', { workspaceInput: '/tmp/workspace-route', clientId: CLIENT_ID })
    await cleanupStarted.promise
    const second = post(app, '/runtime-open', { workspaceInput: '/tmp/workspace-route', clientId: CLIENT_ID })
    cleanupGate.resolve()

    await expect(first).resolves.toMatchObject({ status: 500 })
    await expect(second).resolves.toMatchObject({ status: 500 })
    expect(commitGitCapabilityRemoval).toHaveBeenCalledTimes(2)
    expect(captureWorkspaceRuntimeMembershipLease(USER_ID, CLIENT_ID).entries).toEqual([before])
  })

  test('does not mint a runtime when command-input probing fails', async () => {
    mocks.probeLocalWorkspace.mockResolvedValue({ status: 'unavailable', reason: 'error.path-not-found' })
    const app = createTestWorkspaceRoutes()
    const response = await post(app, '/runtime-open', {
      workspaceInput: '/tmp/missing-workspace',
      clientId: CLIENT_ID,
    })

    await expect(response.json()).resolves.toEqual({
      ok: false,
      input: '/tmp/missing-workspace',
      reason: 'error.path-not-found',
    })
    await expect((await post(app, '/runtime-list', {})).json()).resolves.toEqual({ runtimes: [] })
  })

  test('defers Git cleanup until an unavailable probe becomes conclusive', async () => {
    mocks.probeLocalWorkspace.mockResolvedValue({
      ...readyPlainWorkspace,
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
    const commitGitCapabilityRemoval = vi.fn(async () => ({ kind: 'committed' as const }))
    const app = createWorkspaceRoutes({ workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval } })
    const opened = (await (
      await post(app, '/runtime-open', { workspaceInput: '/tmp/workspace-route', clientId: CLIENT_ID })
    ).json()) as { workspaceRuntimeId: string }
    expect(commitGitCapabilityRemoval).not.toHaveBeenCalled()

    await post(app, '/refresh', { workspaceId: WORKSPACE_ID, workspaceRuntimeId: opened.workspaceRuntimeId })
    await post(app, '/refresh', { workspaceId: WORKSPACE_ID, workspaceRuntimeId: opened.workspaceRuntimeId })
    expect(commitGitCapabilityRemoval).toHaveBeenCalledOnce()
  })

  test('lists and closes the shared epoch only after its last client releases', async () => {
    const app = createTestWorkspaceRoutes()
    const first = (await (
      await post(app, '/runtime-open', { workspaceId: WORKSPACE_ID, clientId: CLIENT_ID })
    ).json()) as {
      workspaceRuntimeId: string
    }
    const secondClientId = 'workspace-route-client-two'
    const second = (await (
      await post(app, '/runtime-open', { workspaceId: WORKSPACE_ID, clientId: secondClientId })
    ).json()) as { workspaceRuntimeId: string }
    expect(second.workspaceRuntimeId).toBe(first.workspaceRuntimeId)
    await expect((await post(app, '/runtime-list', {})).json()).resolves.toMatchObject({
      runtimes: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId: first.workspaceRuntimeId }],
    })

    await expect(
      (
        await post(app, '/runtime-close', {
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: first.workspaceRuntimeId,
          clientId: CLIENT_ID,
        })
      ).json(),
    ).resolves.toEqual({ ok: true, released: true, runtimeClosed: false })
    await expect(
      (
        await post(app, '/runtime-close', {
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: first.workspaceRuntimeId,
          clientId: secondClientId,
        })
      ).json(),
    ).resolves.toEqual({ ok: true, released: true, runtimeClosed: true })
  })

  test('reconciles one client complete workspace declaration atomically', async () => {
    const app = createTestWorkspaceRoutes()
    const oldWorkspaceId = workspaceIdForTest('goblin+file:///tmp/workspace-old')
    const nextWorkspaceId = workspaceIdForTest('goblin+file:///tmp/workspace-next')
    await post(app, '/runtime-open', { workspaceId: oldWorkspaceId, clientId: CLIENT_ID })

    const response = await post(app, '/runtime-reconcile', {
      clientId: CLIENT_ID,
      workspaceIds: [nextWorkspaceId],
    })
    await expect(response.json()).resolves.toMatchObject({
      runtimes: [{ workspaceId: nextWorkspaceId, workspaceRuntimeId: expect.stringMatching(/^workspace-runtime-/) }],
    })
  })

  test('keeps cross-platform canonical identities valid until an execution boundary', async () => {
    const app = createTestWorkspaceRoutes()
    const windowsWorkspaceId = workspaceIdForTest('goblin+file:///C:/workspace')

    const response = await post(app, '/runtime-reconcile', {
      clientId: CLIENT_ID,
      workspaceIds: [windowsWorkspaceId],
    })

    await expect(response.json()).resolves.toMatchObject({
      runtimes: [{ workspaceId: windowsWorkspaceId, workspaceRuntimeId: expect.stringMatching(/^workspace-runtime-/) }],
    })
  })

  test('refreshes the current workspace capability projection', async () => {
    const commitGitCapabilityRemoval = vi.fn(async () => ({ kind: 'committed' as const }))
    const app = createWorkspaceRoutes({ workspaceCapabilityTransitionHost: { commitGitCapabilityRemoval } })
    const opened = (await (
      await post(app, '/runtime-open', { workspaceId: WORKSPACE_ID, clientId: CLIENT_ID })
    ).json()) as { workspaceRuntimeId: string }
    commitWorkspaceProbeState({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: opened.workspaceRuntimeId,
      probe: {
        ...readyPlainWorkspace,
        capabilities: {
          ...readyPlainWorkspace.capabilities,
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
      },
    })

    const response = await post(app, '/refresh', {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: opened.workspaceRuntimeId,
    })
    await expect(response.json()).resolves.toMatchObject({
      kind: 'committed',
      probe: { status: 'ready', capabilities: { git: { status: 'unavailable' } } },
    })
    expect(commitGitCapabilityRemoval).toHaveBeenCalledOnce()
  })

  test('routes filesystem operations through one runtime-bound target', async () => {
    const app = createTestWorkspaceRoutes()
    const workspaceRuntimeId = await openWorkspaceRuntime(app, WORKSPACE_ID)
    const target = workspaceRootTarget(WORKSPACE_ID, workspaceRuntimeId)

    expect((await post(app, '/tree', { target, prefix: 'src' })).status).toBe(200)
    expect((await post(app, '/file-viewer', { target })).status).toBe(200)
    expect((await post(app, '/trash-file', { target, path: 'src/example.ts' })).status).toBe(200)
    expect((await post(app, '/open-terminal', { target, app: 'ghostty' })).status).toBe(200)
    expect((await post(app, '/open-editor', { target, app: 'vscode' })).status).toBe(200)
    expect((await post(app, '/open-in-finder', { target })).status).toBe(200)

    expect(mocks.readWorkspaceFilesystemTree).toHaveBeenCalledWith(target, {
      prefix: 'src',
      signal: expect.any(AbortSignal),
    })
    expect(mocks.readWorkspaceFileViewer).toHaveBeenCalledWith(target, expect.any(AbortSignal))
    expect(mocks.trashWorkspaceFile).toHaveBeenCalledWith(target, 'src/example.ts', expect.any(AbortSignal))
    expect(mocks.openWorkspaceTerminal).toHaveBeenCalledWith(target, 'ghostty', expect.any(AbortSignal))
    expect(mocks.openWorkspaceEditor).toHaveBeenCalledWith(target, 'vscode', expect.any(AbortSignal))
    expect(mocks.openWorkspaceInFinder).toHaveBeenCalledWith(target, expect.any(AbortSignal))
    expect(mocks.publishUserWorkspaceFilesystemInvalidation).toHaveBeenCalledWith(USER_ID, { target })
    expect(mocks.publishUserRepoQueryInvalidation).not.toHaveBeenCalled()
  })

  test('publishes Git projection invalidation only for a Git worktree trash mutation', async () => {
    const app = createTestWorkspaceRoutes()
    const workspaceRuntimeId = await openWorkspaceRuntime(app, WORKSPACE_ID)
    const target = gitWorktreeTarget(
      WORKSPACE_ID,
      workspaceRuntimeId,
      workspaceIdForTest('goblin+file:///tmp/workspace-worktree'),
    )

    const response = await post(app, '/trash-file', { target, path: 'src/example.ts' })

    expect(response.status).toBe(200)
    expect(mocks.publishUserWorkspaceFilesystemInvalidation).toHaveBeenCalledWith(USER_ID, { target })
    expect(mocks.publishUserRepoQueryInvalidation).toHaveBeenCalledWith(USER_ID, {
      repoId: WORKSPACE_ID,
      query: 'repo-snapshot',
    })
  })

  test('rejects a stale filesystem target before invoking native operations', async () => {
    const app = createTestWorkspaceRoutes()
    await openWorkspaceRuntime(app, WORKSPACE_ID)
    const target = workspaceRootTarget(WORKSPACE_ID, 'workspace-runtime-stale')

    const response = await post(app, '/open-in-finder', { target })

    expect(response.status).toBe(400)
    expect(mocks.openWorkspaceInFinder).not.toHaveBeenCalled()
  })

  test.each([
    ['/tree', mocks.readWorkspaceFilesystemTree, (target: ReturnType<typeof workspaceRootTarget>) => ({ target })],
    ['/file-viewer', mocks.readWorkspaceFileViewer, (target: ReturnType<typeof workspaceRootTarget>) => ({ target })],
    [
      '/trash-file',
      mocks.trashWorkspaceFile,
      (target: ReturnType<typeof workspaceRootTarget>) => ({ target, path: 'src/example.ts' }),
    ],
    [
      '/open-terminal',
      mocks.openWorkspaceTerminal,
      (target: ReturnType<typeof workspaceRootTarget>) => ({ target, app: 'ghostty' }),
    ],
    [
      '/open-editor',
      mocks.openWorkspaceEditor,
      (target: ReturnType<typeof workspaceRootTarget>) => ({ target, app: 'vscode' }),
    ],
    ['/open-in-finder', mocks.openWorkspaceInFinder, (target: ReturnType<typeof workspaceRootTarget>) => ({ target })],
  ])('settles the remote workspace runtime when %s hits a transport failure', async (route, mock, body) => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example.test/workspace')
    const app = createTestWorkspaceRoutes()
    const workspaceRuntimeId = await openWorkspaceRuntime(app, workspaceId)
    const target = workspaceRootTarget(workspaceId, workspaceRuntimeId)
    mock.mockRejectedValueOnce(
      new RemoteWorkspaceRuntimeFailureError({
        workspaceId,
        workspaceRuntimeId,
        reason: 'unreachable',
        message: 'connection refused',
      }),
    )

    const response = await post(app, route, body(target))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: 'error.workspace-operation-failed',
    })
    expect(listWorkspaceRuntimes(USER_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId,
          workspaceRuntimeId,
          remoteLifecycle: expect.objectContaining({ kind: 'failed', reason: 'unreachable' }),
        }),
      ]),
    )
    expect(mocks.publishUserWorkspaceRuntimeInvalidation).toHaveBeenCalledWith(USER_ID, { workspaceId })
  })

  test.each([
    ['/runtime-open', { workspaceId: '/tmp/raw-path', clientId: CLIENT_ID }],
    ['/runtime-open', { workspaceId: WORKSPACE_ID, clientId: '' }],
    ['/runtime-open', { workspaceId: WORKSPACE_ID, clientId: 'x'.repeat(129) }],
    ['/runtime-close', { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-test', clientId: '' }],
    [
      '/runtime-close',
      { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-test', clientId: 'x'.repeat(129) },
    ],
    ['/runtime-reconcile', { workspaceIds: [WORKSPACE_ID], clientId: '' }],
    ['/runtime-reconcile', { workspaceIds: [WORKSPACE_ID], clientId: 'x'.repeat(129) }],
    ['/runtime-reconcile', { workspaceIds: ['/tmp/raw-path'], clientId: CLIENT_ID }],
    ['/runtime-reconcile', { workspaceIds: [WORKSPACE_ID, ''], clientId: CLIENT_ID }],
  ])('rejects invalid runtime membership input for %s', async (path, body) => {
    const response = await post(createTestWorkspaceRoutes(), path, body)
    expect(response.status).toBe(400)
  })
})

function createTestWorkspaceRoutes() {
  return createWorkspaceRoutes({
    workspaceCapabilityTransitionHost: {
      commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
    },
  })
}

async function post(app: ReturnType<typeof createWorkspaceRoutes>, route: string, body: object): Promise<Response> {
  return await app.request(
    new Request(`http://localhost${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function openWorkspaceRuntime(
  app: ReturnType<typeof createWorkspaceRoutes>,
  workspaceId: WorkspaceId,
): Promise<string> {
  const response = await post(app, '/runtime-open', { workspaceId, clientId: CLIENT_ID })
  const result = (await response.json()) as { workspaceRuntimeId: string }
  return result.workspaceRuntimeId
}

function workspaceRootTarget(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  return { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId }
}

function gitWorktreeTarget(workspaceId: WorkspaceId, workspaceRuntimeId: string, root: WorkspaceId) {
  return { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId, root }
}
