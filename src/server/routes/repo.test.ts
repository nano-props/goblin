import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

const mocks = vi.hoisted(() => ({
  probeRepo: vi.fn(),
  getRepoSnapshot: vi.fn(),
  getRepoStatus: vi.fn(),
  getRepoLog: vi.fn(),
  getRepoPatch: vi.fn(),
  getRepoPullRequests: vi.fn(),
  readRepoBulk: vi.fn(),
  fetchRepo: vi.fn(),
  cloneRepo: vi.fn(),
  abortCloneOperation: vi.fn(),
  pullRepoBranch: vi.fn(),
  pushRepoBranch: vi.fn(),
  createRepoWorktree: vi.fn(),
  getRepoWorktreeBootstrapPreview: vi.fn(),
  deleteRepoBranch: vi.fn(),
  removeRepoWorktree: vi.fn(),
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
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  getBackgroundSyncDiagnostics: vi.fn(),
}))
vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepo: mocks.probeRepo,
  getRepoSnapshot: mocks.getRepoSnapshot,
  getRepoStatus: mocks.getRepoStatus,
  getRepoLog: mocks.getRepoLog,
  getRepoPatch: mocks.getRepoPatch,
  getRepoPullRequests: mocks.getRepoPullRequests,
  readRepoBulk: mocks.readRepoBulk,
  getRepoWorktreeBootstrapPreview: mocks.getRepoWorktreeBootstrapPreview,
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
  abortCloneOperation: mocks.abortCloneOperation,
  pullRepoBranch: mocks.pullRepoBranch,
  pushRepoBranch: mocks.pushRepoBranch,
  createRepoWorktree: mocks.createRepoWorktree,
  deleteRepoBranch: mocks.deleteRepoBranch,
  removeRepoWorktree: mocks.removeRepoWorktree,
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
vi.mock('#/server/common/identity.ts', () => ({
  userIdFromContext: () => 'user-test',
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const terminalHostStub: ServerTerminalHost = {
  isValidClientId: ((value: unknown): value is string => typeof value === 'string') as never,
  isClientOnline: vi.fn(() => true),
  getDiagnostics: vi.fn(() => ({}) as never),
  registerSocket: vi.fn(),
  unregisterSocket: vi.fn(),
  attach: vi.fn(async () => ({ ok: true }) as never),
  restart: vi.fn(async () => ({ ok: true }) as never),
  write: vi.fn(async () => ({ ok: true }) as never),
  resize: vi.fn(async () => ({ ok: true }) as never),
  takeover: vi.fn(async () => ({ ok: true }) as never),
  close: vi.fn(async () => ({ ok: true }) as never),
  listSessions: vi.fn(async () => []),
  listWorkspaceTabs: vi.fn(async () => []),
  create: vi.fn(async () => ({ ok: true }) as never),
  replaceTabs: vi.fn(async () => []),
  updateTabs: vi.fn(async () => []),
  prune: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
  handleRealtimeMessage: vi.fn(),
  shutdown: vi.fn(),
}

function createTestRepoRoutes() {
  return createRepoRoutes()
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

  test('returns 400 for invalid picklist values in the body (e.g. pull-requests mode)', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/pull-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', mode: 'not-a-mode' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.getRepoPullRequests).not.toHaveBeenCalled()
  })

  test('passes a valid body through to the module layer', async () => {
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/tmp/repo', name: 'repo' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, root: '/tmp/repo', name: 'repo' })
    expect(mocks.probeRepo).toHaveBeenCalledWith('/tmp/repo')
  })

  test('runtime-open with repoInput canonicalizes and binds the runtime id to the probed root', async () => {
    mocks.probeRepo.mockResolvedValue({ ok: true, root: '/tmp/repo', name: 'repo' })
    const app = createTestRepoRoutes()

    const response = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: '/tmp/repo/subdir' }),
      }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      ok: true
      repo: { id: string; name: string }
      repoInstanceId: string
    }
    expect(json).toMatchObject({ ok: true, repo: { id: '/tmp/repo', name: 'repo' } })
    expect(json.repoInstanceId).toMatch(/^repo-instance-/)
    expect(mocks.probeRepo).toHaveBeenCalledWith('/tmp/repo/subdir')
  })

  test('runtime-open with repoInput fails without minting a runtime id when probe fails', async () => {
    mocks.probeRepo.mockResolvedValue({ ok: false, message: 'missing' })
    const app = createTestRepoRoutes()

    const response = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoInput: '/missing' }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: false, input: '/missing', reason: 'missing' })
  })

  test('runtime-list returns the server-owned open runtime instances for the user', async () => {
    const app = createTestRepoRoutes()

    const openResponse = await app.request(
      new Request('http://localhost/runtime-open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoRoot: '/tmp/runtime-list-repo' }),
      }),
    )
    const opened = (await openResponse.json()) as { ok: true; repoInstanceId: string }

    const response = await app.request(
      new Request('http://localhost/runtime-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as { instances: Array<{ repoRoot: string; repoInstanceId: string }> }
    expect(json.instances).toContainEqual({ repoRoot: '/tmp/runtime-list-repo', repoInstanceId: opened.repoInstanceId })
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

    const response = await app.request(
      new Request('http://localhost/worktree-bootstrap-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, preview: { hasOperations: false } })
    expect(mocks.getRepoWorktreeBootstrapPreview).toHaveBeenCalledWith('/tmp/repo', expect.any(AbortSignal))
  })

  test('passes an array of branches through the body to the module layer', async () => {
    mocks.getRepoPullRequests.mockResolvedValue([])
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/pull-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', branches: ['main', 'feature'] }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.getRepoPullRequests).toHaveBeenCalledWith('/tmp/repo', ['main', 'feature'], {
      mode: 'full',
      signal: expect.any(AbortSignal),
    })
  })

  test('passes patch body through to getRepoPatch', async () => {
    mocks.getRepoPatch.mockResolvedValue({ ok: true, message: 'diff --git a b' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/patch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.getRepoPatch).toHaveBeenCalledWith(
      '/tmp/repo',
      '/tmp/repo/.worktrees/feature',
      expect.any(AbortSignal),
    )
  })

  test('hard-fails when repo log reading fails', async () => {
    mocks.getRepoLog.mockRejectedValueOnce(new Error('fatal: bad revision'))
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(500)
    expect(mocks.getRepoLog).toHaveBeenCalledWith('/tmp/repo', 'feature/work', {
      count: 50,
      skip: 0,
      signal: expect.any(AbortSignal),
    })
  })

  test('passes /tree requests through to the read layer', async () => {
    mocks.getRepositoryTree.mockResolvedValueOnce({
      nodes: [
        { id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' },
        { id: 'src/index.ts', path: 'src/index.ts', name: 'index.ts', parentId: 'src', kind: 'file', status: 'modified' },
      ],
      truncated: false,
    })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo/.worktrees/feature', prefix: 'src' }),
      }),
    )
    expect(response.status).toBe(200)
    const json = (await response.json()) as { nodes: Array<{ id: string }>; truncated: boolean }
    expect(json.nodes.map((n) => n.id)).toEqual(['src', 'src/index.ts'])
    expect(json.truncated).toBe(false)
    expect(mocks.getRepositoryTree).toHaveBeenCalledWith(
      '/tmp/repo',
      '/tmp/repo/.worktrees/feature',
      { prefix: 'src' },
    )
  })

  test('does not pass the HTTP request signal into /tree reads', async () => {
    mocks.getRepositoryTree.mockResolvedValueOnce({ nodes: [], truncated: false })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )

    expect(response.status).toBe(200)
    const options = mocks.getRepositoryTree.mock.calls[0]?.[2] as { signal?: AbortSignal } | undefined
    expect(options).toEqual({ prefix: undefined })
    expect(options?.signal).toBeUndefined()
  })

  test('returns 400 when /tree prefix is invalid', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo', prefix: '../secret' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.getRepositoryTree).not.toHaveBeenCalled()
  })

  test('hard-fails when /tree read fails', async () => {
    mocks.getRepositoryTree.mockRejectedValueOnce(new Error('boom'))
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/tree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(500)
  })

  test('passes /file-viewer requests through to the read layer', async () => {
    mocks.getRepositoryFileViewer.mockResolvedValueOnce({ viewer: 'bat', shell: 'posix' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/file-viewer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ viewer: 'bat', shell: 'posix' })
    expect(mocks.getRepositoryFileViewer).toHaveBeenCalledWith(
      '/tmp/repo',
      '/tmp/repo/.worktrees/feature',
      expect.any(AbortSignal),
    )
  })

  test('hard-fails when /file-viewer read fails', async () => {
    mocks.getRepositoryFileViewer.mockRejectedValueOnce(new Error('boom'))
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/file-viewer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo/.worktrees/feature' }),
      }),
    )
    expect(response.status).toBe(500)
  })

  test('passes /trash-file requests through to the filetree write layer', async () => {
    mocks.trashRepositoryFile.mockResolvedValueOnce({ ok: true, message: 'ok' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/trash-file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: '/tmp/repo',
          worktreePath: '/tmp/repo/.worktrees/feature',
          path: 'src/index.ts',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, message: 'ok' })
    expect(mocks.trashRepositoryFile).toHaveBeenCalledWith(
      '/tmp/repo',
      '/tmp/repo/.worktrees/feature',
      'src/index.ts',
      expect.any(AbortSignal),
    )
  })

  test('returns 400 when /trash-file path escapes the worktree', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/trash-file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', worktreePath: '/tmp/repo', path: '../secret.txt' }),
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
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'main', count: 0 }),
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
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'main', count: 2.5 }),
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
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'main', count: '50' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })
})

describe('repo routes — composite read', () => {
  test('returns all three sections by default', async () => {
    mocks.readRepoBulk.mockResolvedValue({
      snapshot: { branches: [], current: 'main' },
      status: [],
      pullRequests: [],
    })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      snapshot: { branches: [], current: 'main' },
      status: [],
      pullRequests: [],
    })
  })

  test('forwards include, branches, and mode to the read function', async () => {
    mocks.readRepoBulk.mockResolvedValue({ snapshot: null, status: [], pullRequests: null })
    const app = createTestRepoRoutes()
    await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cwd: '/tmp/repo',
          include: ['snapshot', 'status'],
          branches: ['main', 'feature'],
          mode: 'summary',
        }),
      }),
    )
    expect(mocks.readRepoBulk).toHaveBeenCalledWith('/tmp/repo', ['snapshot', 'status'], {
      branches: ['main', 'feature'],
      mode: 'summary',
      timeoutMs: undefined,
      signal: expect.any(AbortSignal),
    })
  })

  test('forwards timeoutMs to the read function when provided', async () => {
    mocks.readRepoBulk.mockResolvedValue({ snapshot: null, status: [], pullRequests: null })
    const app = createTestRepoRoutes()
    await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', include: ['snapshot', 'status'], timeoutMs: 2500 }),
      }),
    )
    expect(mocks.readRepoBulk).toHaveBeenCalledWith(
      '/tmp/repo',
      ['snapshot', 'status'],
      expect.objectContaining({ timeoutMs: 2500 }),
    )
  })

  test('returns 400 when timeoutMs is not a number', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', include: ['snapshot', 'status'], timeoutMs: 'soon' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  test('returns 400 when timeoutMs is negative', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', include: ['snapshot', 'status'], timeoutMs: -1 }),
      }),
    )
    expect(response.status).toBe(400)
  })

  test('returns 400 when include has an unknown value', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', include: ['not-a-section'] }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  test('hard-fails when the read function rejects', async () => {
    mocks.readRepoBulk.mockRejectedValue(new Error('backend exploded'))
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(500)
  })
})

describe('repo routes — authoritative repo reads', () => {
  test('hard-fails /snapshot when the read layer rejects', async () => {
    mocks.getRepoSnapshot.mockRejectedValue(new Error('backend exploded'))
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(500)
  })

  test('hard-fails /status when the read layer rejects', async () => {
    mocks.getRepoStatus.mockRejectedValue(new Error('backend exploded'))
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(500)
  })
})

describe('repo routes — POST body validation (action endpoints)', () => {
  test('returns 400 for invalid picklist values in fetch body', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', kind: 'not-a-kind' }),
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

  test('clone route forwards operationId/url/parentPath/directoryName', async () => {
    mocks.cloneRepo.mockResolvedValue({ ok: true, message: 'ok', path: '/tmp/repo' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/clone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: 'op_1',
          url: 'https://example.com/r.git',
          parentPath: '/tmp',
          directoryName: 'r',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.cloneRepo).toHaveBeenCalledWith('op_1', 'https://example.com/r.git', '/tmp', 'r')
  })

  test('open-url route forwards repo URL targets', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: 'https://github.com/acme/repo/commit/abcdef1' })
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/open-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', target: { type: 'commit', hash: 'abcdef1' } }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.openRepoUrl).toHaveBeenCalledWith('/tmp/repo', { type: 'commit', hash: 'abcdef1' }, expect.any(AbortSignal))
  })

  test('forwards external workspace app open routes', async () => {
    mocks.openRepoTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoEditor.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoInFinder.mockResolvedValue({ ok: true, message: '' })
    const app = createTestRepoRoutes()

    await app.request(
      new Request('http://localhost/open-terminal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/repo', app: 'ghostty' }),
      }),
    )
    await app.request(
      new Request('http://localhost/open-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/repo', app: 'vscode' }),
      }),
    )
    await app.request(
      new Request('http://localhost/open-in-finder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/repo' }),
      }),
    )

    expect(mocks.openRepoTerminal).toHaveBeenCalledWith('/tmp/repo', 'ghostty')
    expect(mocks.openRepoEditor).toHaveBeenCalledWith('/tmp/repo', 'vscode')
    expect(mocks.openRepoInFinder).toHaveBeenCalledWith('/tmp/repo')
  })

  test('returns 400 for invalid external app choices', async () => {
    const app = createTestRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/open-editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/repo', app: 'not-an-editor' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.openRepoEditor).not.toHaveBeenCalled()
  })
})
