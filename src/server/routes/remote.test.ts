import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openServerRemoteEditor: vi.fn(),
}))

vi.mock('#/server/modules/remote.ts', () => ({
  getServerSshHosts: vi.fn(async () => ({ hosts: [], hasInclude: false })),
  resolveServerRemoteTarget: vi.fn(),
  getServerRemotePathSuggestions: vi.fn(),
  testServerRemoteRepository: vi.fn(),
  openServerRemoteEditor: mocks.openServerRemoteEditor,
}))

describe('remote routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openServerRemoteEditor.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
  })

  test('opens a remote editor from repo id and worktree path', async () => {
    const { createRemoteRoutes } = await import('#/server/routes/remote.ts')
    const app = createRemoteRoutes()

    const response = await app.request('http://localhost/open-editor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })
    expect(mocks.openServerRemoteEditor).toHaveBeenCalledWith(
      { repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' },
      expect.any(AbortSignal),
    )
  })
})
