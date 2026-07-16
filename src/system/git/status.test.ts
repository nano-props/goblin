import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ git: vi.fn() }))

vi.mock('#/system/git/git-exec.ts', () => ({ git: mocks.git }))

beforeEach(() => {
  mocks.git.mockReset()
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
          'HEAD f00ba4',
          'branch refs/heads/main',
          '',
          'worktree /tmp/worktree-a',
          'HEAD ba5eba1',
          'branch refs/heads/feature/a',
        ].join('\n'),
      )
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('status failed'))
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo')).rejects.toThrow('status failed')
  })

  test('rejects when the signal aborts before a command result is accepted', async () => {
    const controller = new AbortController()
    mocks.git.mockImplementationOnce(async () => {
      controller.abort(new Error('status deadline'))
      return 'worktree /tmp/repo\nHEAD f00ba4\nbranch refs/heads/main'
    })
    const { getWorkingStatus } = await import('#/system/git/status.ts')

    await expect(getWorkingStatus('/tmp/repo', { signal: controller.signal })).rejects.toThrow('status deadline')
  })
})
