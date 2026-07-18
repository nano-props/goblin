import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorktrees: vi.fn(),
  userShellCommandExists: vi.fn(),
  resolveRemoteWorkspaceTarget: vi.fn(),
  remoteRuntimeAwareGitRunner: vi.fn(),
  remoteCommandExists: vi.fn(),
  remoteCommandExistsAtWorkspaceRoot: vi.fn(),
  resolveRemoteWorktree: vi.fn(),
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: mocks.getWorktrees,
}))

vi.mock('#/system/user-shell.ts', () => ({
  userShellCommandExists: mocks.userShellCommandExists,
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRemoteWorkspaceTarget: mocks.resolveRemoteWorkspaceTarget,
  remoteRuntimeAwareGitRunner: mocks.remoteRuntimeAwareGitRunner,
}))

vi.mock('#/system/ssh/git.ts', () => ({
  remoteCommandExists: mocks.remoteCommandExists,
  remoteCommandExistsAtWorkspaceRoot: mocks.remoteCommandExistsAtWorkspaceRoot,
  resolveRemoteWorktree: mocks.resolveRemoteWorktree,
}))

import { getRepositoryFileViewer } from '#/server/modules/repo-file-viewer.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.remoteRuntimeAwareGitRunner.mockReturnValue(async () => ({ ok: true, stdout: '', stderr: '', code: 0 }))
  mocks.getWorktrees.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo-feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
  mocks.resolveRemoteWorktree.mockResolvedValue({
    path: '/srv/repo-feature',
    branch: 'feature',
    isBare: false,
    isPrimary: false,
  })
})

describe('repo file viewer read layer', () => {
  test('resolves a local workspace locator without requiring Git worktree membership', async () => {
    const platformSpy = mockPlatform('linux')
    mocks.userShellCommandExists.mockResolvedValue(false)
    try {
      await expect(
        getRepositoryFileViewer('goblin+file:///tmp/plain-workspace', 'goblin+file:///tmp/plain-workspace'),
      ).resolves.toEqual({ viewer: 'cat', shell: 'posix', executionRoot: '/tmp/plain-workspace' })
      expect(mocks.getWorktrees).not.toHaveBeenCalled()
      expect(mocks.userShellCommandExists).toHaveBeenCalledWith('bat', '/tmp/plain-workspace', undefined)
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('uses bat for local worktrees when the user shell can resolve it', async () => {
    const platformSpy = mockPlatform('linux')
    mocks.userShellCommandExists.mockResolvedValueOnce(true)

    try {
      const result = await getRepositoryFileViewer('goblin+file:///tmp/repo', '/tmp/repo-feature')

      expect(result).toEqual({ viewer: 'bat', shell: 'posix', executionRoot: '/tmp/repo-feature' })
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
      const result = await getRepositoryFileViewer('goblin+file:///tmp/repo', '/tmp/repo-feature')

      expect(result).toEqual({ viewer: 'batcat', shell: 'posix', executionRoot: '/tmp/repo-feature' })
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
      await expect(getRepositoryFileViewer('goblin+file:///tmp/repo', '/tmp/repo-feature')).resolves.toEqual({
        viewer: 'cat',
        shell: 'posix',
        executionRoot: '/tmp/repo-feature',
      })
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('rejects unknown local worktrees without probing the shell', async () => {
    const platformSpy = mockPlatform('linux')

    try {
      await expect(getRepositoryFileViewer('goblin+file:///tmp/repo', '/tmp/outside')).rejects.toThrow(
        'unknown worktree path',
      )

      expect(mocks.userShellCommandExists).not.toHaveBeenCalled()
    } finally {
      platformSpy.mockRestore()
    }
  })

  test('uses batcat for remote repos when bat is unavailable but batcat resolves', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.remoteCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await getRepositoryFileViewer(repoId, '/srv/repo-feature')

    expect(result).toEqual({ viewer: 'batcat', shell: 'posix', executionRoot: '/srv/repo-feature' })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(1, target, '/srv/repo-feature', 'bat', {
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature', isBare: false, isPrimary: false }],
      signal: undefined,
    })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(2, target, '/srv/repo-feature', 'batcat', {
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature', isBare: false, isPrimary: false }],
      signal: undefined,
    })
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
  })

  test('resolves an SSH workspace locator without a Git worktree lookup', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/plain-workspace' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/plain-workspace',
      displayName: 'prod:plain-workspace',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.remoteCommandExistsAtWorkspaceRoot.mockResolvedValueOnce(true)

    await expect(getRepositoryFileViewer(repoId, repoId)).resolves.toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/srv/plain-workspace',
    })
    expect(mocks.resolveRemoteWorktree).not.toHaveBeenCalled()
    expect(mocks.remoteCommandExistsAtWorkspaceRoot).toHaveBeenCalledWith(target, '/srv/plain-workspace', 'bat', {
      signal: undefined,
    })
  })

  test('matches remote worktree paths after POSIX normalization', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.remoteCommandExists.mockResolvedValueOnce(true)

    const result = await getRepositoryFileViewer(repoId, '/srv/repo-feature/')

    expect(result).toEqual({ viewer: 'bat', shell: 'posix', executionRoot: '/srv/repo-feature/' })
    expect(mocks.resolveRemoteWorktree).toHaveBeenCalledWith(target, '/srv/repo-feature/', { signal: undefined })
    expect(mocks.remoteCommandExists).toHaveBeenCalledWith(target, '/srv/repo-feature', 'bat', {
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature', isBare: false, isPrimary: false }],
      signal: undefined,
    })
  })

  test('uses the runtime-aware runner for remote viewer probes when provided', async () => {
    const workspaceRuntimeId = 'repo-runtime-file-viewer-test'
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    const run = async () => ({ ok: true as const, stdout: '', stderr: '', code: 0 })
    mocks.remoteRuntimeAwareGitRunner.mockReturnValueOnce(run)
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.remoteCommandExists.mockResolvedValueOnce(true)

    await expect(
      getRepositoryFileViewer(repoId, '/srv/repo-feature', undefined, { workspaceRuntimeId }),
    ).resolves.toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/srv/repo-feature',
    })

    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(repoId, { workspaceRuntimeId })
    expect(mocks.remoteRuntimeAwareGitRunner).toHaveBeenCalledWith(repoId, workspaceRuntimeId, target)
    expect(mocks.resolveRemoteWorktree).toHaveBeenCalledWith(target, '/srv/repo-feature', {
      signal: undefined,
      run,
    })
    expect(mocks.remoteCommandExists).toHaveBeenCalledWith(
      target,
      '/srv/repo-feature',
      'bat',
      expect.objectContaining({ run }),
    )
  })

  test('rejects unknown remote worktrees without probing viewer commands', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.resolveRemoteWorktree.mockRejectedValueOnce(new Error('unknown worktree path'))

    await expect(getRepositoryFileViewer(repoId, '/srv/missing')).rejects.toThrow('unknown worktree path')

    expect(mocks.remoteCommandExists).not.toHaveBeenCalled()
  })

  test('surfaces remote worktree read failures without falling back to cat', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.resolveRemoteWorktree.mockRejectedValueOnce(new Error('ssh unavailable'))

    await expect(getRepositoryFileViewer(repoId, '/srv/repo-feature')).rejects.toThrow('ssh unavailable')

    expect(mocks.remoteCommandExists).not.toHaveBeenCalled()
  })
})

function mockPlatform(platform: NodeJS.Platform) {
  return vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
}
