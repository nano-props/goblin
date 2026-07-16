import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  getWorktrees: vi.fn(),
  movePathToTrash: vi.fn(),
  resolveRemoteRepoTarget: vi.fn(),
  remoteRuntimeAwareGitRunner: vi.fn(),
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
  resolveRemoteRepoTarget: mocks.resolveRemoteRepoTarget,
  remoteRuntimeAwareGitRunner: mocks.remoteRuntimeAwareGitRunner,
}))

vi.mock('#/system/ssh/git.ts', () => ({
  trashRemoteFile: mocks.trashRemoteFile,
}))

import { trashRepositoryFile } from '#/server/modules/repo-tree-trash.ts'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getWorktrees.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo-feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
  mocks.lstat.mockResolvedValue({ isDirectory: () => false })
  mocks.movePathToTrash.mockResolvedValue({ ok: true, message: 'ok', repositoryStateChanged: true })
  mocks.remoteRuntimeAwareGitRunner.mockReturnValue(async () => ({ ok: true, stdout: '', stderr: '', code: 0 }))
})

describe('repo-tree trash write layer', () => {
  test('resolves a local workspace locator without requiring Git worktree membership', async () => {
    const result = await trashRepositoryFile(
      'goblin+file:///tmp/plain-workspace',
      'goblin+file:///tmp/plain-workspace',
      'notes.txt',
    )

    expect(result.ok).toBe(true)
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.lstat).toHaveBeenCalledWith('/tmp/plain-workspace/notes.txt')
  })

  test('moves a local worktree file to the system trash', async () => {
    const result = await trashRepositoryFile('goblin+file:///tmp/repo', '/tmp/repo-feature', 'src/index.ts')

    expect(result).toEqual({ ok: true, message: 'ok', repositoryStateChanged: true })
    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false, signal: undefined })
    expect(mocks.lstat).toHaveBeenCalledWith('/tmp/repo-feature/src/index.ts')
    expect(mocks.movePathToTrash).toHaveBeenCalledWith('/tmp/repo-feature/src/index.ts', undefined)
  })

  test('rejects an unknown local worktree before touching the file', async () => {
    const result = await trashRepositoryFile('goblin+file:///tmp/repo', '/tmp/outside', 'src/index.ts')

    expect(result).toEqual({ ok: false, message: 'error.invalid-worktree-path' })
    expect(mocks.lstat).not.toHaveBeenCalled()
    expect(mocks.movePathToTrash).not.toHaveBeenCalled()
  })

  test('rejects directories', async () => {
    mocks.lstat.mockResolvedValueOnce({ isDirectory: () => true })

    const result = await trashRepositoryFile('goblin+file:///tmp/repo', '/tmp/repo-feature', 'src')

    expect(result).toEqual({ ok: false, message: 'error.filetree-delete-directory-unsupported' })
    expect(mocks.movePathToTrash).not.toHaveBeenCalled()
  })

  test('delegates remote repo files to the SSH trash helper', async () => {
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
    mocks.trashRemoteFile.mockResolvedValueOnce({ ok: true, message: 'ok', repositoryStateChanged: true })

    const result = await trashRepositoryFile(repoId, '/srv/repo-feature', 'README.md')

    expect(result).toEqual({ ok: true, message: 'ok', repositoryStateChanged: true })
    expect(mocks.trashRemoteFile).toHaveBeenCalledWith(target, '/srv/repo-feature', 'README.md', { signal: undefined })
    expect(mocks.getWorktrees).not.toHaveBeenCalled()
  })

  test('resolves an SSH workspace locator before trashing a file', async () => {
    const repoId = normalizeRemoteRepoId({ alias: 'prod', remotePath: '/srv/plain-workspace' })
    const target = {
      id: repoId,
      alias: 'prod',
      remotePath: '/srv/plain-workspace',
      displayName: 'prod:plain-workspace',
      host: 'example.com',
      user: 'tester',
      port: 22,
    }
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(target)
    mocks.trashRemoteFile.mockResolvedValueOnce({ ok: true, message: 'ok' })

    await trashRepositoryFile(repoId, repoId, 'notes.txt')
    expect(mocks.trashRemoteFile).toHaveBeenCalledWith(target, '/srv/plain-workspace', 'notes.txt', {
      signal: undefined,
    })
  })

  test('uses the runtime-aware runner for remote trash when provided', async () => {
    const repoRuntimeId = 'repo-runtime-trash-test'
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
    const run = async () => ({ ok: true as const, stdout: '', stderr: '', code: 0 })
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(target)
    mocks.remoteRuntimeAwareGitRunner.mockReturnValueOnce(run)
    mocks.trashRemoteFile.mockResolvedValueOnce({ ok: true, message: 'ok', repositoryStateChanged: true })

    await expect(
      trashRepositoryFile(repoId, '/srv/repo-feature', 'README.md', undefined, { repoRuntimeId }),
    ).resolves.toEqual({
      ok: true,
      message: 'ok',
      repositoryStateChanged: true,
    })

    expect(mocks.resolveRemoteRepoTarget).toHaveBeenCalledWith(repoId, { repoRuntimeId })
    expect(mocks.remoteRuntimeAwareGitRunner).toHaveBeenCalledWith(repoId, repoRuntimeId, target)
    expect(mocks.trashRemoteFile).toHaveBeenCalledWith(target, '/srv/repo-feature', 'README.md', {
      signal: undefined,
      run,
    })
  })
})
