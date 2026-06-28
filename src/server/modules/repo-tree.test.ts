import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWithRepoSource: vi.fn(),
  resolveRemoteRepoTarget: vi.fn(),
  getRepoTreeSourceLocal: vi.fn(),
  getRepoTreeSourceRemote: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  runWithRepoSource: mocks.runWithRepoSource,
  resolveRemoteRepoTarget: mocks.resolveRemoteRepoTarget,
}))

vi.mock('#/server/modules/repo-tree-source.ts', () => ({
  getRepoTreeSourceLocal: mocks.getRepoTreeSourceLocal,
  getRepoTreeSourceRemote: mocks.getRepoTreeSourceRemote,
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
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('repo-tree — read layer (local cwd)', () => {
  test('returns the empty envelope when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature', { signal: controller.signal })
    expect(result).toEqual({ nodes: [], truncated: false })
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })

  test('forwards a precomputed status to the local source without re-fetching', async () => {
    const precomputed = [
      {
        path: '/tmp/repo/.worktrees/feature',
        branch: 'main',
        isMain: false,
        entries: [{ x: ' ', y: 'M', path: 'src/index.ts' }],
      },
    ]
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature', {
      precomputedStatus: precomputed,
      depth: 3,
    })

    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({ depth: 3 }),
      undefined,
      precomputed,
    )
  })

  test('fetches a fresh status from the local source when none is supplied', async () => {
    const freshStatus = [
      { path: '/tmp/repo/.worktrees/feature', branch: 'main', isMain: false, entries: [] },
    ]
    const fakeSource = { getStatus: vi.fn().mockResolvedValue(freshStatus) }
    mocks.runWithRepoSource.mockImplementationOnce(async (_cwd, task) => await task(fakeSource))
    mocks.getRepoTreeSourceLocal.mockResolvedValueOnce({
      nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory', status: 'clean' }],
      truncated: false,
    })

    const result = await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature')

    expect(fakeSource.getStatus).toHaveBeenCalledWith(undefined)
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({}),
      undefined,
      freshStatus,
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('soft-fails to the empty envelope when the local source layer throws', async () => {
    const fakeSource = { getStatus: vi.fn().mockResolvedValue([]) }
    mocks.runWithRepoSource.mockImplementationOnce(async (_cwd, task) => await task(fakeSource))
    mocks.getRepoTreeSourceLocal.mockRejectedValueOnce(new Error('boom'))

    await expect(getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature')).rejects.toThrow('boom')
  })
})

describe('repo-tree — read layer (remote cwd, PR 5)', () => {
  test('resolves the target and forwards to the remote source', async () => {
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(remoteTarget)
    const freshStatus = [
      { path: '/srv/repos/myrepo/.worktrees/feature', branch: 'main', isMain: false, entries: [] },
    ]
    const fakeSource = { getStatus: vi.fn().mockResolvedValue(freshStatus) }
    mocks.runWithRepoSource.mockImplementationOnce(async (_cwd, task) => await task(fakeSource))
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({
      nodes: [{ id: 'README.md', path: 'README.md', name: 'README.md', parentId: null, kind: 'file', status: 'clean' }],
      truncated: false,
    })

    const result = await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature', { depth: 4 })

    expect(mocks.resolveRemoteRepoTarget).toHaveBeenCalledWith(remoteRepoId)
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
    expect(fakeSource.getStatus).toHaveBeenCalledWith(undefined)
    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        target: remoteTarget,
        worktreePath: '/srv/repos/myrepo/.worktrees/feature',
        precomputedStatus: freshStatus,
        options: expect.objectContaining({ depth: 4 }),
      }),
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('forwards a precomputed status to the remote source without re-fetching', async () => {
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(remoteTarget)
    const precomputed = [
      {
        path: '/srv/repos/myrepo/.worktrees/feature',
        branch: 'main',
        isMain: false,
        entries: [{ x: ' ', y: 'M', path: 'src/index.ts' }],
      },
    ]
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature', { precomputedStatus: precomputed })

    expect(mocks.resolveRemoteRepoTarget).toHaveBeenCalledWith(remoteRepoId)
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).toHaveBeenCalledWith(
      expect.objectContaining({ precomputedStatus: precomputed }),
    )
  })

  test('soft-fails to the empty envelope when target resolution throws', async () => {
    mocks.resolveRemoteRepoTarget.mockRejectedValueOnce(new Error('ssh config not found'))
    const result = await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature')
    expect(result).toEqual({ nodes: [], truncated: false })
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceRemote).not.toHaveBeenCalled()
  })

  test('returns the empty envelope when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature', {
      signal: controller.signal,
    })
    expect(result).toEqual({ nodes: [], truncated: false })
    expect(mocks.resolveRemoteRepoTarget).not.toHaveBeenCalled()
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
  })

  test('does not invoke the local source for remote cwd', async () => {
    mocks.resolveRemoteRepoTarget.mockResolvedValueOnce(remoteTarget)
    const fakeSource = { getStatus: vi.fn().mockResolvedValue([]) }
    mocks.runWithRepoSource.mockImplementationOnce(async (_cwd, task) => await task(fakeSource))
    mocks.getRepoTreeSourceRemote.mockResolvedValueOnce({ nodes: [], truncated: false })

    await getRepositoryTree(remoteRepoId, '/srv/repos/myrepo/.worktrees/feature')

    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
  })
})
