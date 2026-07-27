import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readWorktreeMembership: vi.fn(),
  userShellCommandExists: vi.fn(),
  resolveRemoteWorkspaceTarget: vi.fn(),
  remoteRuntimeAwareGitRunner: vi.fn(),
  remoteCommandExists: vi.fn(),
  remoteCommandExistsAtWorkspaceRoot: vi.fn(),
  resolveRemoteWorktree: vi.fn(),
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  readWorktreeMembership: mocks.readWorktreeMembership,
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
const localRepoId = workspaceIdForTest('goblin+file:///tmp/repo')
const remoteRepoId = normalizeRemoteWorkspaceId({ alias: 'example', remotePath: '/srv/repo' })
const remoteRepoTarget = {
  id: remoteRepoId,
  alias: 'example',
  remotePath: '/srv/repo',
  displayName: 'example:repo',
  host: 'example.test',
  user: 'developer',
  port: 22,
}
const remotePlainWorkspaceId = normalizeRemoteWorkspaceId({ alias: 'example', remotePath: '/srv/plain-workspace' })
const remotePlainWorkspaceTarget = {
  ...remoteRepoTarget,
  id: remotePlainWorkspaceId,
  remotePath: '/srv/plain-workspace',
  displayName: 'example:plain-workspace',
}
const remoteWorktree = {
  path: '/srv/repo-feature',
  branch: 'feature',
  isBare: false,
  isPrimary: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  mocks.remoteRuntimeAwareGitRunner.mockReturnValue(async () => ({ ok: true, stdout: '', stderr: '', code: 0 }))
  mocks.readWorktreeMembership.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo-feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
  mocks.resolveRemoteWorktree.mockResolvedValue(remoteWorktree)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace file viewer read layer', () => {
  test('resolves a local workspace locator without requiring Git worktree membership', async () => {
    mocks.userShellCommandExists.mockResolvedValue(false)
    await expect(
      readWorkspaceFileViewer(rootTarget(workspaceIdForTest('goblin+file:///tmp/plain-workspace'))),
    ).resolves.toEqual({ viewer: 'cat', shell: 'posix', executionRoot: '/tmp/plain-workspace' })
    expect(mocks.readWorktreeMembership).not.toHaveBeenCalled()
    expect(mocks.userShellCommandExists).toHaveBeenCalledWith('bat', '/tmp/plain-workspace', undefined)
  })

  test('uses bat for local worktrees when the user shell can resolve it', async () => {
    mocks.userShellCommandExists.mockResolvedValueOnce(true)

    const result = await readWorkspaceFileViewer(worktreeTarget(localRepoId, '/tmp/repo-feature'))

    expect(result).toEqual({ viewer: 'bat', shell: 'posix', executionRoot: '/tmp/repo-feature' })
    expect(mocks.readWorktreeMembership).toHaveBeenCalledWith('/tmp/repo', undefined)
    expect(mocks.userShellCommandExists).toHaveBeenCalledWith('bat', '/tmp/repo-feature', undefined)
  })

  test('uses batcat for local worktrees when bat is unavailable but batcat resolves', async () => {
    mocks.userShellCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await readWorkspaceFileViewer(worktreeTarget(localRepoId, '/tmp/repo-feature'))

    expect(result).toEqual({ viewer: 'batcat', shell: 'posix', executionRoot: '/tmp/repo-feature' })
    expect(mocks.userShellCommandExists).toHaveBeenNthCalledWith(1, 'bat', '/tmp/repo-feature', undefined)
    expect(mocks.userShellCommandExists).toHaveBeenNthCalledWith(2, 'batcat', '/tmp/repo-feature', undefined)
  })

  test('falls back to cat for local worktrees when bat and batcat are unavailable', async () => {
    mocks.userShellCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    await expect(readWorkspaceFileViewer(worktreeTarget(localRepoId, '/tmp/repo-feature'))).resolves.toEqual({
      viewer: 'cat',
      shell: 'posix',
      executionRoot: '/tmp/repo-feature',
    })
  })

  test('rejects unknown local worktrees without probing the shell', async () => {
    await expect(readWorkspaceFileViewer(worktreeTarget(localRepoId, '/tmp/outside'))).rejects.toThrow(
      'unknown worktree path',
    )

    expect(mocks.userShellCommandExists).not.toHaveBeenCalled()
  })

  test('uses batcat for remote repos when bat is unavailable but batcat resolves', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteRepoTarget)
    mocks.remoteCommandExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const result = await readWorkspaceFileViewer(worktreeTarget(remoteRepoId, '/srv/repo-feature'))

    expect(result).toEqual({ viewer: 'batcat', shell: 'posix', executionRoot: '/srv/repo-feature' })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(1, remoteRepoTarget, '/srv/repo-feature', 'bat', {
      knownWorktrees: [remoteWorktree],
      run: expect.any(Function),
      signal: undefined,
    })
    expect(mocks.remoteCommandExists).toHaveBeenNthCalledWith(2, remoteRepoTarget, '/srv/repo-feature', 'batcat', {
      knownWorktrees: [remoteWorktree],
      run: expect.any(Function),
      signal: undefined,
    })
    expect(mocks.readWorktreeMembership).not.toHaveBeenCalled()
  })

  test('resolves an SSH workspace locator without a Git worktree lookup', async () => {
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remotePlainWorkspaceTarget)
    mocks.remoteCommandExistsAtWorkspaceRoot.mockResolvedValueOnce(true)

    await expect(readWorkspaceFileViewer(rootTarget(remotePlainWorkspaceId))).resolves.toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/srv/plain-workspace',
    })
    expect(mocks.resolveRemoteWorktree).not.toHaveBeenCalled()
    expect(mocks.remoteCommandExistsAtWorkspaceRoot).toHaveBeenCalledWith(
      remotePlainWorkspaceTarget,
      '/srv/plain-workspace',
      'bat',
      { run: expect.any(Function), signal: undefined },
    )
  })

  test('uses the runtime-aware runner for remote viewer probes when provided', async () => {
    const workspaceRuntimeId = 'workspace-runtime-file-viewer-custom-test'
    const run = async () => ({ ok: true as const, stdout: '', stderr: '', code: 0 })
    mocks.remoteRuntimeAwareGitRunner.mockReturnValueOnce(run)
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteRepoTarget)
    mocks.remoteCommandExists.mockResolvedValueOnce(true)

    await expect(
      readWorkspaceFileViewer(worktreeTarget(remoteRepoId, '/srv/repo-feature', workspaceRuntimeId)),
    ).resolves.toEqual({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/srv/repo-feature',
    })

    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(remoteRepoId, { workspaceRuntimeId }, undefined)
    expect(mocks.remoteRuntimeAwareGitRunner).toHaveBeenCalledWith(remoteRepoId, workspaceRuntimeId, remoteRepoTarget)
    expect(mocks.resolveRemoteWorktree).toHaveBeenCalledWith(remoteRepoTarget, '/srv/repo-feature', {
      signal: undefined,
      run,
    })
    expect(mocks.remoteCommandExists).toHaveBeenCalledWith(
      remoteRepoTarget,
      '/srv/repo-feature',
      'bat',
      expect.objectContaining({ run }),
    )
  })

  test.each([
    ['unknown remote worktree', '/srv/missing', 'unknown worktree path'],
    ['remote worktree read failure', '/srv/repo-feature', 'ssh unavailable'],
  ])('surfaces %s without probing viewer commands', async (_name, worktreePath, message) => {
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(remoteRepoTarget)
    mocks.resolveRemoteWorktree.mockRejectedValueOnce(new Error(message))

    await expect(readWorkspaceFileViewer(worktreeTarget(remoteRepoId, worktreePath))).rejects.toThrow(message)
    expect(mocks.remoteCommandExists).not.toHaveBeenCalled()
  })
})

function rootTarget(workspaceId: WorkspaceId, workspaceRuntimeId = WORKSPACE_RUNTIME_ID) {
  return { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId }
}

function worktreeTarget(workspaceId: WorkspaceId, worktreePath: string, workspaceRuntimeId = WORKSPACE_RUNTIME_ID) {
  const target = gitWorktreeFilesystemExecutionTarget(workspaceId, workspaceRuntimeId, worktreePath)
  if (!target) throw new Error('invalid test worktree target')
  return target
}
