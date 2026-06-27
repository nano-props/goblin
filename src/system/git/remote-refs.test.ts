import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRemoteTrackingBranches } from '#/system/git/remote-refs.ts'

const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', () => ({
  git: gitMock,
}))

describe('getRemoteTrackingBranches', () => {
  beforeEach(() => {
    gitMock.mockReset()
  })

  test('reads and filters remote-tracking refs', async () => {
    const signal = new AbortController().signal
    gitMock.mockResolvedValue('origin/HEAD\norigin/main\norigin/feature/a\n')

    await expect(getRemoteTrackingBranches('/repo', signal)).resolves.toEqual(['origin/main', 'origin/feature/a'])
    expect(gitMock).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'], {
      signal,
    })
  })

  test('returns an empty list when the underlying git call fails', async () => {
    gitMock.mockRejectedValue(new Error('boom'))

    await expect(getRemoteTrackingBranches('/repo')).resolves.toEqual([])
  })
})
