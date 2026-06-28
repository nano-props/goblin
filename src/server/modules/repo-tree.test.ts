import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runWithRepoSource: vi.fn(),
  getRepoTreeSourceLocal: vi.fn(),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  runWithRepoSource: mocks.runWithRepoSource,
}))

vi.mock('#/server/modules/repo-tree-source.ts', () => ({
  getRepoTreeSourceLocal: mocks.getRepoTreeSourceLocal,
}))

import { getRepositoryTree } from '#/server/modules/repo-tree.ts'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('repo-tree — read layer', () => {
  test('returns the empty envelope when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature', { signal: controller.signal })
    expect(result).toEqual({ nodes: [], truncated: false })
    expect(mocks.runWithRepoSource).not.toHaveBeenCalled()
    expect(mocks.getRepoTreeSourceLocal).not.toHaveBeenCalled()
  })

  test('forwards a precomputed status to the source layer without re-fetching', async () => {
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
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({ depth: 3 }),
      undefined,
      precomputed,
    )
  })

  test('fetches a fresh status when none is supplied', async () => {
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
    expect(mocks.getRepoTreeSourceLocal).toHaveBeenCalledWith(
      '/tmp/repo/.worktrees/feature',
      expect.objectContaining({}),
      undefined,
      freshStatus,
    )
    expect(result.nodes).toHaveLength(1)
  })

  test('soft-fails to the empty envelope when the source layer throws', async () => {
    const fakeSource = { getStatus: vi.fn().mockResolvedValue([]) }
    mocks.runWithRepoSource.mockImplementationOnce(async (_cwd, task) => await task(fakeSource))
    mocks.getRepoTreeSourceLocal.mockRejectedValueOnce(new Error('boom'))

    await expect(getRepositoryTree('/tmp/repo', '/tmp/repo/.worktrees/feature')).rejects.toThrow('boom')
  })
})
