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
    const platformSpy = mockPlatform('linux')
    mocks.userShellCommandExists.mockResolvedValueOnce(true)

    try {
      const result = await getRepositoryFileViewer('/tmp/repo', '/tmp/repo-feature')

      expect(result).toEqual({ viewer: 'bat', shell: 'posix' })
      expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false, signal: undefined })
      expect(mocks.userShellCommandExists).toHaveBeenCalledWith('bat', '/tmp/repo-feature', undefined)
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('uses batcat for local worktrees when bat is unavailable but batcat resolves', async () => {
    const platformSpy = mockPlatform('linux')
    mocks.userShellCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    try {
      const result = await getRepositoryFileViewer('/tmp/repo', '/tmp/repo-feature')

      expect(result).toEqual({ viewer: 'batcat', shell: 'posix' })
      expect(mocks.userShellCommandExists).toHaveBeenNthCalledWith(1, 'bat', '/tmp/repo-feature', undefined)
      expect(mocks.userShellCommandExists).toHaveBeenNthCalledWith(2, 'batcat', '/tmp/repo-feature', undefined)
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('falls back to cat for local worktrees when bat and batcat are unavailable', async () => {
    const platformSpy = mockPlatform('linux')
    mocks.userShellCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    try {
      await expect(getRepositoryFileViewer('/tmp/repo', '/tmp/repo-feature')).resolves.toEqual({
        viewer: 'cat',
        shell: 'posix',
      })
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('rejects unknown local worktrees without probing the shell', async () => {
    const platformSpy = mockPlatform('linux')

    try {
      await expect(getRepositoryFileViewer('/tmp/repo', '/tmp/outside')).rejects.toThrow('unknown worktree path')

      expect(mocks.userShellCommandExists).not.toHaveBeenCalled()
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('uses batcat for remote repos when bat is unavailable but batcat resolves', async () => {
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
    mocks.remoteCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await getRepositoryFileViewer(repoId, '/srv/repo-feature')

    expect(result).toEqual({ viewer: 'batcat', shell: 'posix' })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(1, target, '/srv/repo-feature', 'bat', {
      signal: undefined,
    })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(2, target, '/srv/repo-feature', 'batcat', {
      signal: undefined,
    })
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
  })
})

function mockPlatform(platform: NodeJS.Platform) {
  return vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
}
