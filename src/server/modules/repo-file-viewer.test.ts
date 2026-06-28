import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorktrees: vi.fn(),
  userShellCommandExists: vi.fn(),
  resolveRemoteRepoTarget: vi.fn(),
  remoteCommandExists: vi.fn(),
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: mocks.getWorktrees,
}))

vi.mock('#/system/user-shell.ts', () => ({
  userShellCommandExists: mocks.userShellCommandExists,
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRemoteRepoTarget: mocks.resolveRemoteRepoTarget,
}))

vi.mock('#/system/ssh/git.ts', () => ({
  remoteCommandExists: mocks.remoteCommandExists,
}))

import { getRepositoryFileViewer } from '#/server/modules/repo-file-viewer.ts'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getWorktrees.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo-feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
})

describe('repo file viewer read layer', () => {
  test('uses bat for local worktrees when the user shell can resolve it', async () => {
    mocks.userShellCommandExists.mockResolvedValueOnce(true)

    const result = await getRepositoryFileViewer('/tmp/repo', '/tmp/repo-feature')

    expect(result).toEqual({ viewer: 'bat' })
    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false, signal: undefined })
    expect(mocks.userShellCommandExists).toHaveBeenCalledWith('bat', '/tmp/repo-feature', undefined)
  })

  test('falls back to cat for local worktrees when bat is unavailable', async () => {
    mocks.userShellCommandExists.mockResolvedValueOnce(false)

    await expect(getRepositoryFileViewer('/tmp/repo', '/tmp/repo-feature')).resolves.toEqual({ viewer: 'cat' })
  })

  test('does not probe the shell for unknown local worktrees', async () => {
    const result = await getRepositoryFileViewer('/tmp/repo', '/tmp/outside')

    expect(result).toEqual({ viewer: 'cat' })
    expect(mocks.userShellCommandExists).not.toHaveBeenCalled()
  })

  test('delegates remote repos to the SSH command resolver', async () => {
    const repoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(target)
    mocks.remoteCommandExists.mockResolvedValueOnce(true)

    const result = await getRepositoryFileViewer(repoId, '/srv/repo-feature')

    expect(result).toEqual({ viewer: 'bat' })
    expect(mocks.remoteCommandExists).toHaveBeenCalledWith(target, '/srv/repo-feature', 'bat', { signal: undefined })
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
  })
})
