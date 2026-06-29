import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveRemoteRepoTarget: vi.fn(),
  getRepoTreeSourceLocal: vi.fn(),
  getRepoTreeSourceRemote: vi.fn(),
  getWorktrees: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRemoteRepoTarget: mocks.resolveRemoteRepoTarget,
}))

vi.mock('#/server/modules/repo-tree-source.ts', () => ({
  getRepoTreeSourceLocal: mocks.getRepoTreeSourceLocal,
  getRepoTreeSourceRemote: mocks.getRepoTreeSourceRemote,
}))

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: mocks.getWorktrees,
}))

import { getRepositoryTree } from '#/server/modules/repo-tree.ts'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const remoteRepoId = normalizeRemoteRepoId({ alias: 'mybox', remotePath: '/srv/repos/myrepo' })
const remoteTarget: RemoteRepoTarget = {
  id: remoteRepoId,
  alias: 'mybox',
  remotePath: '/srv/repos/myrepo',
  displayName: 'mybox:myrepo',
  host: 'mybox.local',
  user: 'git',
  port: 22,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getWorktrees.mockResolvedValue([
    { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
    { path: '/tmp/repo/.worktrees/feature', branch: 'feature', isBare: false, isPrimary: false },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('repo-tree — read layer', () => {
  test('validates a local worktree and forwards to the local source', async () => {
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({
      nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
      truncated: false,
    })

    const result = await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature', { prefix: 'src' })

    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', {
      includeStatus: false,
    })
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({ prefix: 'src' }),
      undefined,
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('keeps transport cancellation out of the tree read boundary', async () => {
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature')

    expect(mocks.getWorktrees).toHaveBeenCalledWith('/tmp/repo', { includeStatus: false })
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.any(Object),
      undefined,
    )
  })

  test('uses precomputed worktrees when the caller already has them', async () => {
    const precomputedWorktrees = [
      { path: '/tmp/repo/.worktrees/feature', branch: 'feature', isBare: false, isPrimary: false },
    ]
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature', { precomputedWorktrees })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalled()
  })

  test('rejects an unknown local worktree path before invoking the source', async () => {
    const result = await getRepositoryTree('/tmp/repo', '/etc/passwd')

    expect(result).toEqual({ nodes: [], truncated: false })
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
  })

  test('soft-fails when the local source throws', async () => {
    mocks.getRepoTreeSourceLocal.mockRejectedValueOnce(new Error('boom'))

    const result = await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature')

    expect(result).toEqual({ nodes: [], truncated: false })
  })

  test('resolves a remote target and forwards to the remote source', async () => {
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(remoteTarget)
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    })

    const result = await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature', { prefix: 'src' })

    expect(mocks.getWorktrees).not.toHaveBeenCalled()
    expect(mocks.resolveRemoteRepoTarget).toHaveBeenCalledWith(remoteRepoId)
    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        target: remoteTarget,
        worktreePath: '/srv/repos/myrepo/.worktrees/feature',
        options: expect.objectContaining({ prefix: 'src' }),
      }),
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('threads precomputed remote worktrees into the remote source', async () => {
    const precomputedWorktrees = [
      { path: '/srv/repos/myrepo/.worktrees/feature', branch: 'feature', isBare: false, isPrimary: false },
    ]
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(remoteTarget)
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature', { precomputedWorktrees })

    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({ knownWorktrees: precomputedWorktrees }),
    )
  })

  test('soft-fails when remote target resolution fails', async () => {
    mocks.resolveRemoteRepoTarget.mockRejectedValueOnce(new Error('ssh config not found'))

    const result = await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature')

    expect(result).toEqual({ nodes: [], truncated: false })
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })

  test('rejects malformed worktree paths before any source call', async () => {
    expect(await getRepositoryTree('/tmp/repo', '')).toEqual({ nodes: [], truncated: false })
    expect(await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature\0/etc/passwd')).toEqual({
      nodes: [],
      truncated: false,
    })
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })
})
