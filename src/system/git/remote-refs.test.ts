import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRemoteTrackingBranches } from '#/system/git/remote-refs.ts'

const gitMock = vi.hoisted(() => vi.fn())
const gitLookupMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', () => ({
  git: gitMock,
  gitLookup: gitLookupMock,
}))

describe('getRemoteTrackingBranches', () => {
  beforeEach(() => {
    gitMock.mockReset()
    gitLookupMock.mockReset()
  })

  test('reads and filters remote-tracking refs', async () => {
    const signal = new AbortController().signal
    gitMock.mockImplementation(async (_cwd: string, args: string[]) =>
      args[0] === 'remote'
        ? 'origin\thttps://example.test/repo.git (fetch)\norigin\thttps://example.test/repo.git (push)'
        : 'refs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/feature/a\n',
    )
    gitLookupMock.mockResolvedValue('+refs/heads/*:refs/remotes/origin/*')

    await expect(getRemoteTrackingBranches('/repo', signal)).resolves.toEqual([
      { ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' },
      { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
    ])
    expect(gitMock).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname)', 'refs/remotes/'], {
      signal,
    })
    expect(gitLookupMock).toHaveBeenCalledWith(
      '/repo',
      ['config', '--get-all', '--', 'remote.origin.fetch'],
      { signal },
    )
  })

  test('propagates failure from the authoritative git read', async () => {
    gitMock.mockRejectedValue(new Error('boom'))

    await expect(getRemoteTrackingBranches('/repo')).rejects.toThrow('boom')
  })
})
