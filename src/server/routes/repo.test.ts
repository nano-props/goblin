import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRepoRoutes } from '#/server/routes/repo.ts'

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
  openRepoRemote: vi.fn(),
  openRepoTerminal: vi.fn(),
  openRepoEditor: vi.fn(),
  openRepoInFinder: vi.fn(),
  setBackgroundSyncRepos: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  abortRepoOperation: vi.fn(),
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
  openRepoRemote: mocks.openRepoRemote,
  openRepoTerminal: mocks.openRepoTerminal,
  openRepoEditor: mocks.openRepoEditor,
  openRepoInFinder: mocks.openRepoInFinder,
}))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('repo routes — POST body validation (read endpoints)', () => {
  test('returns 400 when the body is missing required fields', async () => {
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()

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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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

  test('returns an error envelope when repo log reading fails', async () => {
    mocks.getRepoLog.mockRejectedValueOnce(new Error('fatal: bad revision'))
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'feature/work' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, message: 'error.failed-read-repo' })
    expect(mocks.getRepoLog).toHaveBeenCalledWith('/tmp/repo', 'feature/work', {
      count: 50,
      skip: 0,
      signal: expect.any(AbortSignal),
    })
  })

  test('returns 400 when count is below the minimum (1)', async () => {
    // Body schema is `v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))`
    // — POST body has no string coercion, so a wrong type also 400s.
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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

  test('soft-fails to the default envelope when the read function rejects', async () => {
    // Mirrors the existing jsonOr behaviour for /snapshot, /status,
    // and /pull-requests: a backend failure on the composite
    // endpoint returns the empty default rather than a 5xx, so
    // the client can keep rendering whatever it already has.
    mocks.readRepoBulk.mockRejectedValue(new Error('backend exploded'))
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/repo' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: null, status: [], pullRequests: null })
  })
})

describe('repo routes — POST body validation (action endpoints)', () => {
  test('returns 400 for invalid picklist values in fetch body', async () => {
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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
    const app = createRepoRoutes()
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

  test('forwards external workspace app open routes', async () => {
    mocks.openRepoTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoEditor.mockResolvedValue({ ok: true, message: '' })
    mocks.openRepoInFinder.mockResolvedValue({ ok: true, message: '' })
    const app = createRepoRoutes()

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
        body: JSON.stringify({ path: '/tmp/repo', app: 'windsurf' }),
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
    expect(mocks.openRepoEditor).toHaveBeenCalledWith('/tmp/repo', 'windsurf')
    expect(mocks.openRepoInFinder).toHaveBeenCalledWith('/tmp/repo')
  })

  test('returns 400 for invalid external app choices', async () => {
    const app = createRepoRoutes()
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
