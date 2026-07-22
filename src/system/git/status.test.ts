import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ git: vi.fn(), stat: vi.fn() }))

vi.mock('#/system/git/git-exec.ts', () => ({ git: mocks.git }))
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }))

beforeEach(() => {
  mocks.git.mockReset()
  mocks.stat.mockReset()
})

describe('getWorkingStatus', () => {
  test('rejects when the worktree list cannot be read', async () => {
    mocks.git.mockRejectedValueOnce(new Error('worktree list failed'))
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('worktree list failed')
  })

  test('rejects the complete read when one non-bare worktree status fails', async () => {
    mocks.git
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/worktree-a',
          'HEAD ba5eba1',
          'branch refs/heads/feature/a',
        ].join('\0') + '\0\0',
      )
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('status failed'))
    mocks.stat.mockResolvedValueOnce({})
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('status failed')
  })

  test('rejects when a listed worktree disappears during status sampling', async () => {
    mocks.git
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/worktree-a',
          'HEAD ba5eba1',
          'branch refs/heads/feature/a',
        ].join('\0') + '\0\0',
      )
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('cwd disappeared'))
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('cwd disappeared')
  })

  test('does not run status for a prunable worktree with a missing path', async () => {
    mocks.git
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/missing-worktree',
          'HEAD ba5eba1',
          'branch refs/heads/stale',
          'prunable gitdir file points to non-existent location',
        ].join('\0') + '\0\0',
      )
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(
        [
          'worktree /tmp/repo',
          'HEAD f00ba4a',
          'branch refs/heads/main',
          '',
          'worktree /tmp/missing-worktree',
          'HEAD ba5eba1',
          'branch refs/heads/stale',
          'prunable gitdir file points to non-existent location',
        ].join('\0') + '\0\0',
      )
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).resolves.toEqual([
      { path: '/tmp/repo', branch: 'main', isMain: true, entries: [] },
    ])
    expect(mocks.git).toHaveBeenCalledTimes(3)
  })

  test('rejects when the signal aborts before a command result is accepted', async () => {
    const controller = new AbortController()
    mocks.git.mockImplementationOnce(async () => {
      controller.abort(new Error('status deadline'))
      return 'worktree /tmp/repo\nHEAD f00ba4a\nbranch refs/heads/main'
    })
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo', { signal: controller.signal })).rejects.toThrow('status deadline')
  })
})
