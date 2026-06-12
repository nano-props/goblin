import { describe, expect, test, vi } from 'vitest'
import { createRepoRoutes } from '#/server/routes/repo.ts'

const mocks = vi.hoisted(() => ({
  probeRepository: vi.fn(),
  getRepositorySnapshot: vi.fn(),
  getRepositoryStatus: vi.fn(),
  getRepositoryPatch: vi.fn(),
  getRepositoryPullRequests: vi.fn(),
  getRepositoryComposite: vi.fn(),
  fetchRepository: vi.fn(),
  cloneRepository: vi.fn(),
  abortCloneOperation: vi.fn(),
  checkoutRepositoryBranch: vi.fn(),
  pullRepositoryBranch: vi.fn(),
  pushRepositoryBranch: vi.fn(),
  createRepositoryWorktree: vi.fn(),
  deleteRepositoryBranch: vi.fn(),
  removeRepositoryWorktree: vi.fn(),
  openRepositoryRemote: vi.fn(),
  openRepositoryTerminal: vi.fn(),
  openRepositoryEditor: vi.fn(),
  setBackgroundSyncRepos: vi.fn(),
  getBackgroundSyncRepos: vi.fn(),
  getServerFetchIntervalSec: vi.fn(),
  abortRepositoryOperation: vi.fn(),
}))

vi.mock('#/server/modules/background-sync.ts', () => ({
  setBackgroundSyncRepos: mocks.setBackgroundSyncRepos,
  getBackgroundSyncRepos: mocks.getBackgroundSyncRepos,
  getBackgroundSyncDiagnostics: vi.fn(),
}))
vi.mock('#/server/modules/repo-read-paths.ts', () => ({
  probeRepository: mocks.probeRepository,
  getRepositorySnapshot: mocks.getRepositorySnapshot,
  getRepositoryStatus: mocks.getRepositoryStatus,
  getRepositoryPatch: mocks.getRepositoryPatch,
  getRepositoryPullRequests: mocks.getRepositoryPullRequests,
  getRepositoryComposite: mocks.getRepositoryComposite,
}))
vi.mock('#/server/modules/repo-write-paths.ts', () => ({
  cloneRepository: mocks.cloneRepository,
  abortCloneOperation: mocks.abortCloneOperation,
  checkoutRepositoryBranch: mocks.checkoutRepositoryBranch,
  pullRepositoryBranch: mocks.pullRepositoryBranch,
  pushRepositoryBranch: mocks.pushRepositoryBranch,
  createRepositoryWorktree: mocks.createRepositoryWorktree,
  deleteRepositoryBranch: mocks.deleteRepositoryBranch,
  removeRepositoryWorktree: mocks.removeRepositoryWorktree,
  fetchRepository: mocks.fetchRepository,
  abortRepositoryOperation: mocks.abortRepositoryOperation,
  openRepositoryRemote: mocks.openRepositoryRemote,
  openRepositoryTerminal: mocks.openRepositoryTerminal,
  openRepositoryEditor: mocks.openRepositoryEditor,
}))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerFetchIntervalSec: mocks.getServerFetchIntervalSec,
}))

describe('repo routes — GET query validation', () => {
  test('returns 400 when the query is missing required fields', async () => {
    const app = createRepoRoutes()
    const response = await app.request(new Request('http://localhost/probe'))
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string; message: string }
    expect(json).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(json.message).toContain('cwd')
    expect(mocks.probeRepository).not.toHaveBeenCalled()
  })

  test('returns 400 for invalid picklist values in the query (e.g. pull-requests mode)', async () => {
    const app = createRepoRoutes()
    const response = await app.request(new Request('http://localhost/pull-requests?cwd=/tmp/repo&mode=not-a-mode'))
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.getRepositoryPullRequests).not.toHaveBeenCalled()
  })

  test('passes a valid query through to the module layer', async () => {
    mocks.probeRepository.mockResolvedValue({ ok: true, root: '/tmp/repo', name: 'repo' })
    const app = createRepoRoutes()
    const response = await app.request(new Request('http://localhost/probe?cwd=/tmp/repo'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, root: '/tmp/repo', name: 'repo' })
    expect(mocks.probeRepository).toHaveBeenCalledWith('/tmp/repo')
  })

  test('passes repeated query keys as arrays (e.g. branches)', async () => {
    mocks.getRepositoryPullRequests.mockResolvedValue([])
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/pull-requests?cwd=/tmp/repo&branches=main&branches=feature'),
    )
    expect(response.status).toBe(200)
    expect(mocks.getRepositoryPullRequests).toHaveBeenCalledWith('/tmp/repo', ['main', 'feature'], {
      mode: 'full',
      signal: expect.any(AbortSignal),
    })
  })

  test('passes patch query through to getRepositoryPatch', async () => {
    mocks.getRepositoryPatch.mockResolvedValue({ ok: true, message: 'diff --git a b' })
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/patch?cwd=/tmp/repo&worktreePath=/tmp/repo/.worktrees%2Ffeature'),
    )
    expect(response.status).toBe(200)
    expect(mocks.getRepositoryPatch).toHaveBeenCalledWith(
      '/tmp/repo',
      '/tmp/repo/.worktrees/feature',
      expect.any(AbortSignal),
    )
  })
})

describe('repo routes — composite read', () => {
  test('returns all three sections by default', async () => {
    mocks.getRepositoryComposite.mockResolvedValue({
      snapshot: { branches: [], current: 'main' },
      status: [],
      pullRequests: [],
    })
    const app = createRepoRoutes()
    const response = await app.request(new Request('http://localhost/composite?cwd=/tmp/repo'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      snapshot: { branches: [], current: 'main' },
      status: [],
      pullRequests: [],
    })
  })

  test('forwards include, branches, and mode to the read function', async () => {
    mocks.getRepositoryComposite.mockResolvedValue({ snapshot: null, status: [], pullRequests: null })
    const app = createRepoRoutes()
    await app.request(
      new Request(
        'http://localhost/composite?cwd=/tmp/repo&include=snapshot&include=status&branches=main&branches=feature&mode=summary',
      ),
    )
    expect(mocks.getRepositoryComposite).toHaveBeenCalledWith('/tmp/repo', ['snapshot', 'status'], {
      branches: ['main', 'feature'],
      mode: 'summary',
      timeoutMs: undefined,
      signal: expect.any(AbortSignal),
    })
  })

  test('forwards timeoutMs to the read function when provided', async () => {
    mocks.getRepositoryComposite.mockResolvedValue({ snapshot: null, status: [], pullRequests: null })
    const app = createRepoRoutes()
    await app.request(
      new Request('http://localhost/composite?cwd=/tmp/repo&include=snapshot&include=status&timeoutMs=2500'),
    )
    expect(mocks.getRepositoryComposite).toHaveBeenCalledWith(
      '/tmp/repo',
      ['snapshot', 'status'],
      expect.objectContaining({ timeoutMs: 2500 }),
    )
  })

  test('returns 400 when timeoutMs is non-numeric', async () => {
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite?cwd=/tmp/repo&include=snapshot&include=status&timeoutMs=soon'),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
  })

  test('returns 400 when timeoutMs is negative', async () => {
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/composite?cwd=/tmp/repo&include=snapshot&include=status&timeoutMs=-1'),
    )
    expect(response.status).toBe(400)
  })

  test('returns 400 when include has an unknown value', async () => {
    const app = createRepoRoutes()
    const response = await app.request(new Request('http://localhost/composite?cwd=/tmp/repo&include=not-a-section'))
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
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
    expect(mocks.fetchRepository).not.toHaveBeenCalled()
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
    mocks.cloneRepository.mockResolvedValue({ ok: true, message: 'ok', path: '/tmp/repo' })
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
    expect(mocks.cloneRepository).toHaveBeenCalledWith('op_1', 'https://example.com/r.git', '/tmp', 'r')
  })
})
