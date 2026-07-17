import { beforeEach, describe, expect, test, vi } from 'vitest'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import {
  clearRepoRuntimesForUser,
  commitWorkspaceProbeState,
  runSerializedWorkspaceRefresh,
} from '#/server/modules/repo-runtimes.ts'
import { RemoteRepoRuntimeFailureError } from '#/server/modules/remote-runtime-failure.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const WORKSPACE_ID = 'goblin+file:///tmp/repo'

const mocks = vi.hoisted(() => ({
  probeRepo: vi.fn(),
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
  openRepoTerminal: vi.fn(),
  openRepoUrl: vi.fn(),
  openRepoEditor: vi.fn(),
  openRepoInFinder: vi.fn(),
  setBackgroundSyncRepos: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  abortRepoOperation: vi.fn(),
  getRepositoryTree: vi.fn(),
  getRepositoryFileViewer: vi.fn(),
  trashRepositoryFile: vi.fn(),
  publishRepoQueryInvalidation: vi.fn(),
  publishUserRepoQueryInvalidation: vi.fn(),
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  getBackgroundSyncDiagnostics: vi.fn(),
}))
vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
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
vi.mock('#/server/modules/repo-tree.ts', () => ({
  getRepositoryTree: mocks.getRepositoryTree,
}))
vi.mock('#/server/modules/repo-file-viewer.ts', () => ({
  getRepositoryFileViewer: mocks.getRepositoryFileViewer,
}))
vi.mock('#/server/modules/repo-tree-trash.ts', () => ({
  trashRepositoryFile: mocks.trashRepositoryFile,
}))
vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  cloneRepo: mocks.cloneRepo,
  pullRepoBranch: mocks.pullRepoBranch,
  pushRepoBranch: mocks.pushRepoBranch,
  createRepoWorktree: mocks.createRepoWorktree,
  deleteRepoBranch: mocks.deleteRepoBranch,
  removeCapturedRepoWorktree: mocks.removeCapturedRepoWorktree,
  fetchRepo: mocks.fetchRepo,
  abortRepoOperation: mocks.abortRepoOperation,
  openRepoTerminal: mocks.openRepoTerminal,
  openRepoUrl: mocks.openRepoUrl,
  openRepoEditor: mocks.openRepoEditor,
  openRepoInFinder: mocks.openRepoInFinder,
}))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
}))
vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishRepoQueryInvalidation: mocks.publishRepoQueryInvalidation,
  publishUserRepoQueryInvalidation: mocks.publishUserRepoQueryInvalidation,
}))
vi.mock('#/server/common/identity.ts', () => ({
  userIdFromContext: () => 'user-test',
}))

beforeEach(() => {
  vi.clearAllMocks()
  clearRepoRuntimesForUser('user-test')
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
  mocks.probeWorkspace.mockImplementation(mocks.probeLocalWorkspace)
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
    removeGitScopedResources: vi.fn(),
  },
) {
  return createRepoRoutes({
    worktreeRemovalApplication,
    repoMutationApplication,
    workspaceCapabilityTransitionHost,
  })
}

async function openTestRepoRuntime(
  app: ReturnType<typeof createTestRepoRoutes>,
  repoRoot = WORKSPACE_ID,
): Promise<string> {
  const response = await app.request(
    new Request('http://localhost/runtime-open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoRoot, clientId: 'client-read-test' }),
    }),
  )
  const json = (await response.json()) as { ok: true; repoRuntimeId: string }
  commitWorkspaceProbeState({
    userId: 'user-test',
    repoRoot,
    repoRuntimeId: json.repoRuntimeId,
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
  return json.repoRuntimeId
}

async function expectRemoteRuntimeFailed(
  app: ReturnType<typeof createTestRepoRoutes>,
  repoId: string,
  repoRuntimeId: string,
): Promise<void> {
  const listResponse = await app.request(
    new Request('http://localhost/runtime-list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  )
  await expect(listResponse.json()).resolves.toMatchObject({
    runtimes: [
      {
        repoRoot: repoId,
        repoRuntimeId,
        remoteLifecycle: { kind: 'failed', reason: 'unreachable' },
      },
    ],
  })
}

describe('repo routes — POST body validation (read endpoints)', () => {
  test('returns 400 when the body is missing required fields', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string; message: string }
    expect(json).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(json.message).toContain('cwd')
    expect(mocks.probeRepo).not.toHaveBeenCalled()
  })

  test('returns 400 when the body is empty (no content-length)', async () => {
    // `parseHttpBody` treats an empty body as `undefined` and lets the
    // schema decide — a required-field schema must still 400 even
    // without a JSON envelope.
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.probeRepo).not.toHaveBeenCalled()
  })

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

  test('passes a valid body through to the module layer', async () => {
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/tmp/repo', name: 'repo' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, root: '/tmp/repo', name: 'repo' })
    expect(mocks.probeRepo).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  test('runtime-open with repoInput preserves the opened directory identity', async () => {
    mocks.probeLocalWorkspace.mockResolvedValue({
      status: 'ready',
      name: 'subdir',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    const removeGitScopedResources = vi.fn(async () => undefined)
    const app = createTestRepoRoutes(undefined, undefined, { removeGitScopedResources })

    const response = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: '/tmp/repo/subdir', clientId: 'client-test' }),
      }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      ok: true
      repo: { id: string; name: string }
      repoRuntimeId: string
    }
    expect(json).toMatchObject({
      ok: true,
      repo: { id: 'goblin+file:///tmp/repo/subdir', name: 'subdir' },
      capabilities: { git: { status: 'unavailable' } },
    })
    expect(json.repoRuntimeId).toMatch(/^repo-runtime-/)
    expect(mocks.probeLocalWorkspace).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo/subdir',
      process.platform === 'win32' ? 'win32' : 'posix',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(removeGitScopedResources).toHaveBeenCalledOnce()
    expect(removeGitScopedResources).toHaveBeenCalledWith({
      userId: 'user-test',
      workspaceId: 'goblin+file:///tmp/repo/subdir',
      workspaceRuntimeId: json.repoRuntimeId,
      assertCurrent: expect.any(Function),
    })
  })

  test('defers initial diagnostic Git cleanup until unavailability becomes conclusive', async () => {
    mocks.probeLocalWorkspace.mockResolvedValue({
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [{ scope: 'git', message: 'Git probe timed out' }],
    })
    const removeGitScopedResources = vi.fn(async () => undefined)
    const app = createTestRepoRoutes(undefined, undefined, { removeGitScopedResources })
    const opened = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: '/tmp/diagnostic', clientId: 'client-test' }),
      }),
    )
    const openedJson = (await opened.json()) as { ok: true; repo: { id: string }; repoRuntimeId: string }
    expect(removeGitScopedResources).not.toHaveBeenCalled()

    mocks.probeWorkspace.mockResolvedValue({
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    await app.request(
      new Request('http://localhost/workspace-refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: openedJson.repo.id, workspaceRuntimeId: openedJson.repoRuntimeId }),
      }),
    )
    await app.request(
      new Request('http://localhost/workspace-refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: openedJson.repo.id, workspaceRuntimeId: openedJson.repoRuntimeId }),
      }),
    )

    expect(removeGitScopedResources).toHaveBeenCalledOnce()
  })

  test('runtime-open with repoInput fails without minting a runtime id when probe fails', async () => {
    mocks.probeLocalWorkspace.mockResolvedValue({ status: 'unavailable', reason: 'error.workspace-path-not-found' })
    const app = createTestRepoRoutes()

    const response = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: '/missing', clientId: 'client-test' }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      input: '/missing',
      reason: 'error.workspace-path-not-found',
    })
  })

  test('runtime-list returns the server-owned open runtimes for the user', async () => {
    const app = createTestRepoRoutes()

    const openResponse = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoRoot: 'goblin+file:///tmp/runtime-list-repo', clientId: 'client-test' }),
      }),
    )
    const opened = (await openResponse.json()) as { ok: true; repoRuntimeId: string }

    const response = await app.request(
      new Request('http://localhost/runtime-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as { runtimes: Array<{ repoRoot: string; repoRuntimeId: string }> }
    expect(json.runtimes).toContainEqual({
      repoRoot: 'goblin+file:///tmp/runtime-list-repo',
      repoRuntimeId: opened.repoRuntimeId,
      remoteLifecycle: null,
      workspaceProbe: { status: 'probing' },
    })
  })

  test('rejects raw paths at runtime membership admission', async () => {
    const app = createTestRepoRoutes()
    const post = async (path: string, body: object) =>
      await app.request(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )

    const opened = await post('/runtime-open', { repoRoot: '/tmp/raw-path', clientId: 'client-test' })
    expect(opened.status).toBe(400)
    await expect(opened.json()).resolves.toMatchObject({ message: 'repoRoot: Invalid workspace ID' })

    const reconciled = await post('/runtime-reconcile', {
      clientId: 'client-test',
      repoRoots: ['goblin+file:///tmp/valid', '/tmp/raw-path'],
    })
    expect(reconciled.status).toBe(400)
    await expect(reconciled.json()).resolves.toMatchObject({ message: 'repoRoots.1: Invalid workspace ID' })
    const listed = await post('/runtime-list', {})
    await expect(listed.json()).resolves.toEqual({ runtimes: [] })
  })

  test('workspace-refresh commits a conclusive capability result for the current runtime', async () => {
    const removeGitScopedResources = vi.fn(async () => undefined)
    const app = createTestRepoRoutes(undefined, undefined, { removeGitScopedResources })
    const workspaceId = 'goblin+file:///tmp/workspace-refresh'
    const workspaceRuntimeId = await openTestRepoRuntime(app, workspaceId)
    mocks.probeLocalWorkspace.mockResolvedValue({
      status: 'ready',
      name: 'workspace-refresh',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })

    const response = await app.request(
      new Request('http://localhost/workspace-refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, workspaceRuntimeId }),
      }),
    )

    await expect(response.json()).resolves.toMatchObject({
      kind: 'committed',
      probe: { status: 'ready', capabilities: { git: { status: 'unavailable' } } },
    })
    expect(removeGitScopedResources).toHaveBeenCalledWith({
      userId: 'user-test',
      workspaceId,
      workspaceRuntimeId,
      assertCurrent: expect.any(Function),
    })
  })

  test('rejects Git reads after the server commits Git unavailable', async () => {
    const app = createTestRepoRoutes()
    const workspaceId = 'goblin+file:///tmp/plain-workspace'
    const workspaceRuntimeId = await openTestRepoRuntime(app, workspaceId)
    await runSerializedWorkspaceRefresh({
      userId: 'user-test',
      repoRoot: workspaceId,
      repoRuntimeId: workspaceRuntimeId,
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
        body: JSON.stringify({ cwd: workspaceId, repoRuntimeId: workspaceRuntimeId }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'error.workspace-git-unavailable' })
    expect(mocks.readRepoProjection).not.toHaveBeenCalled()
  })

  test('keeps one shared runtime until the last client membership closes', async () => {
    const app = createTestRepoRoutes()
    const open = async (clientId: string) =>
      (await (
        await app.request(
          new Request('http://localhost/runtime-open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ repoRoot: 'goblin+file:///tmp/shared-runtime', clientId }),
          }),
        )
      ).json()) as { repoRuntimeId: string }
    const first = await open('client-a')
    const second = await open('client-b')
    expect(second.repoRuntimeId).toBe(first.repoRuntimeId)
    const close = async (clientId: string) =>
      await (
        await app.request(
          new Request('http://localhost/runtime-close', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              repoRoot: 'goblin+file:///tmp/shared-runtime',
              repoRuntimeId: first.repoRuntimeId,
              clientId,
            }),
          }),
        )
      ).json()
    await expect(close('client-a')).resolves.toEqual({ ok: true, released: true, runtimeClosed: false })
    await expect(close('client-b')).resolves.toEqual({ ok: true, released: true, runtimeClosed: true })
  })

  test.each([
    ['/runtime-open', { repoRoot: '/tmp/invalid-client', clientId: '' }],
    ['/runtime-open', { repoRoot: '/tmp/invalid-client', clientId: 'x'.repeat(129) }],
    ['/runtime-close', { repoRoot: '/tmp/invalid-client', repoRuntimeId: 'repo-runtime-test', clientId: '' }],
    [
      '/runtime-close',
      { repoRoot: '/tmp/invalid-client', repoRuntimeId: 'repo-runtime-test', clientId: 'x'.repeat(129) },
    ],
    ['/runtime-reconcile', { repoRoots: ['/tmp/invalid-client'], clientId: '' }],
    ['/runtime-reconcile', { repoRoots: ['/tmp/invalid-client'], clientId: 'x'.repeat(129) }],
  ])('returns 400 when %s receives an invalid clientId', async (path, body) => {
    const response = await createTestRepoRoutes().request(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )

    expect(response.status).toBe(400)
  })

  test('returns 400 when runtime reconcile contains an empty repo root', async () => {
    const response = await createTestRepoRoutes().request(
      new Request('http://localhost/runtime-reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'client-a', repoRoots: ['/tmp/valid', ''] }),
      }),
    )

    expect(response.status).toBe(400)
  })

  test('reconciles a client window membership declaration in one request', async () => {
    const app = createTestRepoRoutes()
    const post = async (path: string, body: object) =>
      await app.request(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
    const old = (await (
      await post('/runtime-open', {
        repoRoot: 'goblin+file:///tmp/reconcile-old',
        clientId: 'client-a',
      })
    ).json()) as { repoRuntimeId: string }
    await post('/runtime-open', { repoRoot: 'goblin+file:///tmp/reconcile-old', clientId: 'client-b' })

    const response = await post('/runtime-reconcile', {
      clientId: 'client-a',
      repoRoots: ['goblin+file:///tmp/reconcile-new'],
    })

    expect(response.status).toBe(200)
    const reconciled = (await response.json()) as {
      runtimes: Array<{ repoRoot: string; repoRuntimeId: string }>
    }
    expect(reconciled.runtimes).toContainEqual(
      expect.objectContaining({
        repoRoot: 'goblin+file:///tmp/reconcile-new',
        repoRuntimeId: expect.stringMatching(/^repo-runtime-/),
      }),
    )
    const listed = (await (await post('/runtime-list', {})).json()) as {
      runtimes: Array<{ repoRoot: string; repoRuntimeId: string }>
    }
    expect(listed.runtimes).toContainEqual(
      expect.objectContaining({
        repoRoot: 'goblin+file:///tmp/reconcile-old',
        repoRuntimeId: old.repoRuntimeId,
      }),
    )
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
    const repoRuntimeId = await openTestRepoRuntime(app)

    const response = await app.request(
      new Request('http://localhost/worktree-bootstrap-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, preview: { hasOperations: false } })
    expect(mocks.getRepoWorktreeBootstrapPreview).toHaveBeenCalledWith(WORKSPACE_ID, {
      signal: expect.any(AbortSignal),
      repoRuntimeId,
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
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/projection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, branch: 'feature/a' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoProjection).toHaveBeenCalledWith(WORKSPACE_ID, {
      branch: 'feature/a',
      mode: 'full',
      signal: expect.any(AbortSignal),
      repoRuntimeId,
    })
    expect(await response.json()).toMatchObject({ requested: { branch: 'feature/a', pullRequestMode: 'full' } })
  })

  test('returns a complete repo-runtime-scoped worktree status snapshot', async () => {
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    mocks.readRepoWorktreeStatus.mockResolvedValue({
      repoRuntimeId,
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }],
      loadedAt: 123,
    })

    const response = await app.request(
      new Request('http://localhost/worktree-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoWorktreeStatus).toHaveBeenCalledWith(WORKSPACE_ID, {
      signal: expect.any(AbortSignal),
      repoRuntimeId,
    })
    expect(await response.json()).toMatchObject({ repoRuntimeId, status: [{ path: '/tmp/repo' }] })
  })

  test('returns repo operation state snapshots', async () => {
    mocks.readRepoOperationsSnapshot.mockResolvedValue({
      operations: [
        {
          id: 'repo-op-1',
          repoId: WORKSPACE_ID,
          repoRuntimeId: null,
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
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, includeSettled: true }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.readRepoOperationsSnapshot).toHaveBeenCalledWith(WORKSPACE_ID, {
      includeSettled: true,
      repoRuntimeId,
      signal: expect.any(AbortSignal),
    })
    expect(await response.json()).toMatchObject({ operations: [{ kind: 'fetch', phase: 'running' }] })
  })

  test('passes patch body through to getRepoPatch', async () => {
    mocks.getRepoPatch.mockResolvedValue({ ok: true, message: 'diff --git a b' })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/patch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.getRepoPatch).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/repo/.worktrees/feature', {
      signal: expect.any(AbortSignal),
      repoRuntimeId,
    })
  })

  test('hard-fails when repo log reading fails', async () => {
    mocks.getRepoLog.mockRejectedValueOnce(new Error('fatal: bad revision'))
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, branch: 'feature/work', count: 50 }),
      }),
    )

    expect(response.status).toBe(500)
    expect(mocks.getRepoLog).toHaveBeenCalledWith(WORKSPACE_ID, 'feature/work', {
      count: 50,
      skip: 0,
      signal: expect.any(AbortSignal),
      repoRuntimeId,
    })
  })

  test('rejects stale runtime-scoped repo reads before the module layer', async () => {
    const app = createTestRepoRoutes()
    await openTestRepoRuntime(app)

    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId: 'repo-runtime-stale', branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.repo-runtime-stale' })
    expect(mocks.getRepoLog).not.toHaveBeenCalled()
  })

  test('marks remote lifecycle failed when a runtime-scoped repo read hits transport failure', async () => {
    const app = createTestRepoRoutes()
    const repoId = 'goblin+ssh://prod/home/alice/service'
    const repoRuntimeId = await openTestRepoRuntime(app, repoId)
    mocks.getRepoLog.mockRejectedValueOnce(
      new RemoteRepoRuntimeFailureError({
        repoRoot: repoId,
        repoRuntimeId,
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
        body: JSON.stringify({ cwd: repoId, repoRuntimeId, branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.failed-read-repo' })
    const listResponse = await app.request(
      new Request('http://localhost/runtime-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(listResponse.json()).resolves.toMatchObject({
      runtimes: [
        {
          repoRoot: repoId,
          repoRuntimeId,
          remoteLifecycle: { kind: 'failed', reason: 'unreachable' },
        },
      ],
    })
    expect(mocks.publishUserRepoQueryInvalidation).toHaveBeenCalledWith('user-test', {
      repoId,
      query: 'remote-lifecycle',
    })
  })

  test.each([
    {
      name: 'worktree-bootstrap-preview',
      path: '/worktree-bootstrap-preview',
      body: (repoId: string, repoRuntimeId: string) => ({ cwd: repoId, repoRuntimeId }),
      mock: mocks.getRepoWorktreeBootstrapPreview,
    },
    {
      name: 'tree',
      path: '/tree',
      body: (repoId: string, repoRuntimeId: string) => ({
        cwd: repoId,
        repoRuntimeId,
        worktreePath: '/home/alice/service/.worktrees/feature',
      }),
      mock: mocks.getRepositoryTree,
    },
    {
      name: 'file-viewer',
      path: '/file-viewer',
      body: (repoId: string, repoRuntimeId: string) => ({
        cwd: repoId,
        repoRuntimeId,
        worktreePath: '/home/alice/service/.worktrees/feature',
      }),
      mock: mocks.getRepositoryFileViewer,
    },
    {
      name: 'open-url',
      path: '/open-url',
      body: (repoId: string, repoRuntimeId: string) => ({
        cwd: repoId,
        repoRuntimeId,
        target: { type: 'branch' as const, branch: 'feature/work' },
      }),
      mock: mocks.openRepoUrl,
    },
    {
      name: 'trash-file',
      path: '/trash-file',
      body: (repoId: string, repoRuntimeId: string) => ({
        cwd: repoId,
        repoRuntimeId,
        worktreePath: '/home/alice/service/.worktrees/feature',
        path: 'src/index.ts',
      }),
      mock: mocks.trashRepositoryFile,
    },
  ])('marks remote lifecycle failed when /$name hits transport failure', async ({ path, body, mock }) => {
    const app = createTestRepoRoutes()
    const repoId = 'goblin+ssh://prod/home/alice/service'
    const repoRuntimeId = await openTestRepoRuntime(app, repoId)
    mock.mockRejectedValueOnce(
      new RemoteRepoRuntimeFailureError({
        repoRoot: repoId,
        repoRuntimeId,
        reason: 'unreachable',
        message: 'connection refused',
      }),
    )

    const response = await app.request(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body(repoId, repoRuntimeId)),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.failed-read-repo' })
    await expectRemoteRuntimeFailed(app, repoId, repoRuntimeId)
    expect(mocks.publishUserRepoQueryInvalidation).toHaveBeenCalledWith('user-test', {
      repoId,
      query: 'remote-lifecycle',
    })
  })

  test('marks remote lifecycle failed when a runtime-scoped repo write hits transport failure', async () => {
    const app = createTestRepoRoutes()
    const repoId = 'goblin+ssh://prod/home/alice/service'
    const repoRuntimeId = await openTestRepoRuntime(app, repoId)
    mocks.pullRepoBranch.mockRejectedValueOnce(
      new RemoteRepoRuntimeFailureError({
        repoRoot: repoId,
        repoRuntimeId,
        reason: 'unreachable',
        message: 'connection refused',
      }),
    )

    const response = await app.request(
      new Request('http://localhost/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: repoId, repoRuntimeId, branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: 'error.failed-read-repo' })
    expect(mocks.pullRepoBranch).toHaveBeenCalledWith(repoId, 'feature/work', undefined, expect.any(AbortSignal), {
      repoRuntimeId,
    })
    const listResponse = await app.request(
      new Request('http://localhost/runtime-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(listResponse.json()).resolves.toMatchObject({
      runtimes: [
        {
          repoRoot: repoId,
          repoRuntimeId,
          remoteLifecycle: { kind: 'failed', reason: 'unreachable' },
        },
      ],
    })
  })

  test('passes /tree requests through to the read layer', async () => {
    mocks.getRepositoryTree.mockResolvedValueOnce({
      nodes: [
        { id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' },
        {
          id: 'src/index.ts',
          path: 'src/index.ts',
          name: 'index.ts',
          parentId: 'src',
          kind: 'file',
          status: 'modified',
        },
      ],
      truncated: false,
    })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          repoRuntimeId,
          worktreePath: '/tmp/repo/.worktrees/feature',
          prefix: 'src',
        }),
      }),
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as { nodes: Array<{ id: string }>; truncated: boolean }
    expect(json.nodes.map((n) => n.id)).toEqual(['src', 'src/index.ts'])
    expect(json.truncated).toBe(false)
    expect(mocks.getRepositoryTree).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/repo/.worktrees/feature', {
      prefix: 'src',
      repoRuntimeId,
    })
  })

  test('does not pass the HTTP request signal into /tree reads', async () => {
    mocks.getRepositoryTree.mockResolvedValueOnce({ nodes: [], truncated: false })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )

    expect(response.status).toBe(200)
    const options = mocks.getRepositoryTree.mock.calls[0]?.[2] as { signal?: AbortSignal } | undefined
    expect(options).toEqual({ prefix: undefined, repoRuntimeId })
    expect(options?.signal).toBeUndefined()
  })

  test('returns 400 when /tree prefix is invalid', async () => {
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo', prefix: '../secret' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.getRepositoryTree).not.toHaveBeenCalled()
  })

  test('hard-fails when /tree read fails', async () => {
    mocks.getRepositoryTree.mockRejectedValueOnce(new Error('boom'))
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(500)
  })

  test('passes /file-viewer requests through to the read layer', async () => {
    mocks.getRepositoryFileViewer.mockResolvedValueOnce({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/tmp/repo/.worktrees/feature',
    })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/file-viewer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/tmp/repo/.worktrees/feature',
    })
    expect(mocks.getRepositoryFileViewer).toHaveBeenCalledWith(
      WORKSPACE_ID,
      '/tmp/repo/.worktrees/feature',
      expect.any(AbortSignal),
      { repoRuntimeId },
    )
  })

  test('hard-fails when /file-viewer read fails', async () => {
    mocks.getRepositoryFileViewer.mockRejectedValueOnce(new Error('boom'))
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/file-viewer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(500)
  })

  test('passes /trash-file requests through to the filetree write layer', async () => {
    mocks.trashRepositoryFile.mockResolvedValueOnce({ ok: true, message: 'ok' })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/trash-file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          repoRuntimeId,
          worktreePath: '/tmp/repo/.worktrees/feature',
          path: 'src/index.ts',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, message: 'ok' })
    expect(mocks.trashRepositoryFile).toHaveBeenCalledWith(
      WORKSPACE_ID,
      '/tmp/repo/.worktrees/feature',
      'src/index.ts',
      expect.any(AbortSignal),
      { repoRuntimeId },
    )
  })

  test('returns 400 when /trash-file path escapes the worktree', async () => {
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/trash-file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, worktreePath: '/tmp/repo', path: '../secret.txt' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.trashRepositoryFile).not.toHaveBeenCalled()
  })

  test('returns 400 when count is below the minimum (1)', async () => {
    // Body schema is `v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))`
    // — POST body has no string coercion, so a wrong type also 400s.
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId: 'repo-runtime-test', branch: 'main', count: 0 }),
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
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId: 'repo-runtime-test', branch: 'main', count: 2.5 }),
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
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId: 'repo-runtime-test', branch: 'main', count: '50' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })
})

describe('repo routes — POST body validation (action endpoints)', () => {
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
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.fetchRepo).toHaveBeenCalledWith(WORKSPACE_ID, 'user', expect.any(AbortSignal), repoRuntimeId)
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
    const repoRuntimeId = await openTestRepoRuntime(app, WORKSPACE_ID)
    const response = await app.request(
      new Request('http://localhost/remove-worktree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: WORKSPACE_ID,
          repoRuntimeId,
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
        repoRuntimeId,
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
      { repoRuntimeId },
    )
  })

  test('open-url route forwards repo URL targets', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: 'https://github.com/acme/repo/commit/abcdef1' })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)
    const response = await app.request(
      new Request('http://localhost/open-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, target: { type: 'commit', hash: 'abcdef1' } }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.openRepoUrl).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { type: 'commit', hash: 'abcdef1' },
      expect.any(AbortSignal),
      { repoRuntimeId },
    )
  })

  test('delegates branch deletion to the repo mutation application', async () => {
    const deleteBranch = vi.fn(async (_userId, input) => await input.deleteBranch())
    const app = createTestRepoRoutes(undefined, { deleteBranch })
    const repoRuntimeId = await openTestRepoRuntime(app)
    mocks.deleteRepoBranch.mockResolvedValueOnce({ ok: true, message: 'ok' })

    const response = await app.request('/delete-branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, branch: 'feature/retired' }),
    })

    expect(response.status).toBe(200)
    expect(deleteBranch).toHaveBeenCalledWith('user-test', {
      repoRoot: WORKSPACE_ID,
      repoRuntimeId,
      branchName: 'feature/retired',
      deleteBranch: expect.any(Function),
    })

    mocks.deleteRepoBranch.mockResolvedValueOnce({ ok: false, message: 'delete failed' })
    await app.request('/delete-branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: WORKSPACE_ID, repoRuntimeId, branch: 'feature/kept' }),
    })
    expect(deleteBranch).toHaveBeenCalledTimes(2)
  })

  test('forwards external workspace app open routes', async () => {
    mocks.openRepoTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoEditor.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoInFinder.mockResolvedValue({ ok: true, message: '' })
    const app = createTestRepoRoutes()
    const repoRuntimeId = await openTestRepoRuntime(app)

    await app.request(
      new Request('http://localhost/open-terminal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoId: WORKSPACE_ID,
          repoRuntimeId,
          worktreePath: '/tmp/repo',
          app: 'ghostty',
        }),
      }),
    )
    await app.request(
      new Request('http://localhost/open-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoId: WORKSPACE_ID,
          repoRuntimeId,
          worktreePath: '/tmp/repo',
          app: 'vscode',
        }),
      }),
    )
    await app.request(
      new Request('http://localhost/open-in-finder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoId: WORKSPACE_ID, worktreePath: '/tmp/repo' }),
      }),
    )

    expect(mocks.openRepoTerminal).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/repo', 'ghostty', expect.any(AbortSignal), {
      repoRuntimeId,
    })
    expect(mocks.openRepoEditor).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/repo', 'vscode', expect.any(AbortSignal), {
      repoRuntimeId,
    })
    expect(mocks.openRepoInFinder).toHaveBeenCalledWith(WORKSPACE_ID, '/tmp/repo')
  })

  test('marks the current runtime failed when external app open hits a remote runtime failure', async () => {
    const app = createTestRepoRoutes()
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const repoId = target!.id
    const repoRuntimeId = await openTestRepoRuntime(app, repoId)
    mocks.openRepoTerminal.mockRejectedValue(
      new RemoteRepoRuntimeFailureError({
        repoRoot: repoId,
        repoRuntimeId,
        reason: 'unreachable',
      }),
    )

    const response = await app.request(
      new Request('http://localhost/open-terminal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoId,
          repoRuntimeId,
          worktreePath: '/srv/repo',
          app: 'ghostty',
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expectRemoteRuntimeFailed(app, repoId, repoRuntimeId)
  })

  test('returns 400 for invalid external app choices', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/open-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoId: WORKSPACE_ID,
          worktreePath: '/tmp/repo',
          app: 'not-an-editor',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.openRepoEditor).not.toHaveBeenCalled()
  })
})
