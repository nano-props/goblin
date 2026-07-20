import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  getWorktrees: vi.fn(),
  movePathToTrash: vi.fn(),
  resolveRemoteWorkspaceTarget: vi.fn(),
  remoteRuntimeAwareGitRunner: vi.fn(),
  resolveRemoteWorktree: vi.fn(),
  trashRemoteFile: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  lstat: mocks.lstat,
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: mocks.getWorktrees,
}))

vi.mock('#/system/trash.ts', () => ({
  movePathToTrash: mocks.movePathToTrash,
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRemoteWorkspaceTarget: mocks.resolveRemoteWorkspaceTarget,
  remoteRuntimeAwareGitRunner: mocks.remoteRuntimeAwareGitRunner,
}))

vi.mock('#/system/ssh/git.ts', () => ({
  resolveRemoteWorktree: mocks.resolveRemoteWorktree,
  trashRemoteFile: mocks.trashRemoteFile,
}))

import { trashWorkspaceFile } from '#/server/modules/workspace-file-trash.ts'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_RUNTIME_ID = 'workspace-runtime-trash-test'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getWorktrees.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo-feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
  mocks.lstat.mockResolvedValue({ isDirectory: () => false })
  mocks.movePathToTrash.mockResolvedValue({ ok: true, message: 'ok', repositoryStateChanged: true })
  mocks.remoteRuntimeAwareGitRunner.mockReturnValue(async () => ({ ok: true, stdout: '', stderr: '', code: 0 }))
  mocks.resolveRemoteWorktree.mockResolvedValue({
    path: '/srv/repo-feature',
    branch: 'feature',
    isBare: false,
    isPrimary: false,
  })
})

describe('workspace file trash write layer', () => {
  test('resolves a local workspace locator without requiring Git worktree membership', async () => {
    const result = await trashWorkspaceFile(
      rootTarget(workspaceIdForTest('goblin+file:///tmp/plain-workspace')),
      'notes.txt',
    )

    expect(result.ok).toBe(true)
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.lstat).toHaveBeenCalledWith('/tmp/plain-workspace/notes.txt')
  })

  test('moves a local worktree file to the system trash', async () => {
    const result = await trashWorkspaceFile(
      worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/repo-feature'),
      'src/index.ts',
    )

    expect(result).toEqual({ ok: true, message: 'ok', repositoryStateChanged: true })
    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false, signal: undefined })
    expect(mocks.lstat).toHaveBeenCalledWith('/tmp/repo-feature/src/index.ts')
    expect(mocks.movePathToTrash).toHaveBeenCalledWith('/tmp/repo-feature/src/index.ts', undefined)
  })

  test('rejects an unknown local worktree before touching the file', async () => {
    await expect(
      trashWorkspaceFile(worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/outside'), 'src/index.ts'),
    ).rejects.toThrow('unknown worktree path')
    expect(mocks.lstat).not.toHaveBeenCalled()
    expect(mocks.movePathToTrash).not.toHaveBeenCalled()
  })

  test('rejects directories', async () => {
    mocks.lstat.mockResolvedValueOnce({ isDirectory: () => true })

    const result = await trashWorkspaceFile(
      worktreeTarget(workspaceIdForTest('goblin+file:///tmp/repo'), '/tmp/repo-feature'),
      'src',
    )

    expect(result).toEqual({ ok: false, message: 'error.filetree-delete-directory-unsupported' })
    expect(mocks.movePathToTrash).not.toHaveBeenCalled()
  })

  test('delegates remote workspace files to the SSH trash helper', async () => {
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
    mocks.trashRemoteFile.mockResolvedValueOnce({ ok: true, message: 'ok', repositoryStateChanged: true })

    const result = await trashWorkspaceFile(worktreeTarget(repoId, '/srv/repo-feature'), 'README.md')

    expect(result).toEqual({ ok: true, message: 'ok', repositoryStateChanged: true })
    expect(mocks.trashRemoteFile).toHaveBeenCalledWith(target, '/srv/repo-feature', 'README.md', {
      run: expect.any(Function),
      signal: undefined,
    })
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
  })

  test('resolves an SSH workspace locator before trashing a file', async () => {
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
    mocks.trashRemoteFile.mockResolvedValueOnce({ ok: true, message: 'ok' })

    await trashWorkspaceFile(rootTarget(repoId), 'notes.txt')
    expect(mocks.trashRemoteFile).toHaveBeenCalledWith(target, '/srv/plain-workspace', 'notes.txt', {
      run: expect.any(Function),
      signal: undefined,
    })
  })

  test('uses the runtime-aware runner for remote trash when provided', async () => {
    const workspaceRuntimeId = 'workspace-runtime-trash-custom-test'
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
    mocks.resolveRemoteWorkspaceTarget.mockResolvedValueOnce(target)
    mocks.remoteRuntimeAwareGitRunner.mockReturnValueOnce(run)
    mocks.trashRemoteFile.mockResolvedValueOnce({ ok: true, message: 'ok', repositoryStateChanged: true })

    await expect(
      trashWorkspaceFile(worktreeTarget(repoId, '/srv/repo-feature', workspaceRuntimeId), 'README.md'),
    ).resolves.toEqual({
      ok: true,
      message: 'ok',
      repositoryStateChanged: true,
    })

    expect(mocks.resolveRemoteWorkspaceTarget).toHaveBeenCalledWith(repoId, { workspaceRuntimeId }, undefined)
    expect(mocks.remoteRuntimeAwareGitRunner).toHaveBeenCalledWith(repoId, workspaceRuntimeId, target)
    expect(mocks.trashRemoteFile).toHaveBeenCalledWith(target, '/srv/repo-feature', 'README.md', {
      signal: undefined,
      run,
    })
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
