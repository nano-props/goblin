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

import { readWorkspaceFileViewer } from '#/server/modules/workspace-file-viewer.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_RUNTIME_ID = 'workspace-runtime-file-viewer-test'

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

describe('workspace file viewer read layer', () => {
  test('resolves a local workspace locator without requiring Git worktree membership', async () => {
    const platformSpy = mockPlatform('linux')
    mocks.userShellCommandExists.mockResolvedValue(false)
    try {
      await expect(
        readWorkspaceFileViewer(rootTarget(workspaceIdForTest('goblin+file:///tmp/plain-workspace'))),
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
      const result = await readWorkspaceFileViewer(
        worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/repo-feature'),
      )

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
      const result = await readWorkspaceFileViewer(
        worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/repo-feature'),
      )

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
      await expect(
        readWorkspaceFileViewer(worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/repo-feature')),
      ).resolves.toEqual({
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
      await expect(
        readWorkspaceFileViewer(worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/outside')),
      ).rejects.toThrow('unknown worktree path')

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

    const result = await readWorkspaceFileViewer(worktreeTarget(repoId, '/srv/repo-feature'))

    expect(result).toEqual({ viewer: 'batcat', shell: 'posix', executionRoot: '/srv/repo-feature' })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(1, target, '/srv/repo-feature', 'bat', {
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature', isBare: false, isPrimary: false }],
      run: expect.any(Function),
      signal: undefined,
    })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(2, target, '/srv/repo-feature', 'batcat', {
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature', isBare: false, isPrimary: false }],
      run: expect.any(Function),
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

    await expect(readWorkspaceFileViewer(rootTarget(repoId))).resolves.toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/srv/plain-workspace',
    })
    expect(mocks.resolveRemoteWorktree).not.toHaveBeenCalled()
    expect(mocks.remoteCommandExistsAtWorkspaceRoot).toHaveBeenCalledWith(target, '/srv/plain-workspace', 'bat', {
      run: expect.any(Function),
      signal: undefined,
    })
  })

  test('uses the runtime-aware runner for remote viewer probes when provided', async () => {
    const workspaceRuntimeId = 'workspace-runtime-file-viewer-custom-test'
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
      readWorkspaceFileViewer(worktreeTarget(repoId, '/srv/repo-feature', workspaceRuntimeId)),
    ).resolves.toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/srv/repo-feature',
    })

    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(repoId, { workspaceRuntimeId }, undefined)
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

    await expect(readWorkspaceFileViewer(worktreeTarget(repoId, '/srv/missing'))).rejects.toThrow(
      'unknown worktree path',
    )

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

    await expect(readWorkspaceFileViewer(worktreeTarget(repoId, '/srv/repo-feature'))).rejects.toThrow(
      'ssh unavailable',
    )

    expect(mocks.remoteCommandExists).not.toHaveBeenCalled()
  })
})

function mockPlatform(platform: NodeJS.Platform) {
  return vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
}

function rootTarget(workspaceId: WorkspaceId, workspaceRuntimeId = WORKSPACE_RUNTIME_ID) {
  return { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId }
}

function worktreeTarget(workspaceId: WorkspaceId, worktreePath: string, workspaceRuntimeId = WORKSPACE_RUNTIME_ID) {
  const target = gitWorktreeFilesystemExecutionTarget(workspaceId, workspaceRuntimeId, worktreePath)
  if (!target) throw new Error('invalid test worktree target')
  return target
}
