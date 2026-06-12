import { describe, expect, test, vi } from 'vitest'
import { createRepoRoutes } from '#/server/routes/repo.ts'

const mocks = vi.hoisted(() => ({
  probeRepository: vi.fn(),
  getRepositorySnapshot: vi.fn(),
  getRepositoryStatus: vi.fn(),
  getRepositoryPatch: vi.fn(),
  getRepositoryPullRequests: vi.fn(),
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

describe('repo routes — input validation', () => {
  test('returns 400 BAD_REQUEST when the body is missing required fields', async () => {
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string; message: string }
    expect(json).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(json.message).toContain('cwd')
    expect(mocks.probeRepository).not.toHaveBeenCalled()
  })

  test('returns 400 when the body is not a JSON object', async () => {
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify('not-an-object'),
      }),
    )
    expect(response.status).toBe(400)
  })

  test('returns 400 for invalid picklist values (e.g. fetch kind)', async () => {
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

  test('passes a valid body through to the module layer', async () => {
    mocks.probeRepository.mockResolvedValue({ ok: true, root: '/tmp/repo', name: 'repo' })
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
    expect(mocks.probeRepository).toHaveBeenCalledWith('/tmp/repo')
  })

  test('returns 400 when the body is empty', async () => {
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '',
      }),
    )
    expect(response.status).toBe(400)
  })

  test('returns 400 when the body is malformed JSON', async () => {
    const app = createRepoRoutes()
    const response = await app.request(
      new Request('http://localhost/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    )
    expect(response.status).toBe(400)
  })
})

describe('repo routes — body parsing', () => {
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
