import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRemoteTrackingBranches } from '#/system/git/remote-refs.ts'

const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/helper.ts', () => ({
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
})
