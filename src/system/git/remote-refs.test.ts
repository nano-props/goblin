import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRemoteTrackingBranches } from '#/system/git/remote-refs.ts'

const gitMock = vi.hoisted(() => vi.fn())
const gitScalarMock = vi.hoisted(() => vi.fn())
const gitLookupMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', () => ({
  git: gitMock,
  gitScalar: gitScalarMock,
  gitLookup: gitLookupMock,
}))

describe('getRemoteTrackingBranches', () => {
  beforeEach(() => {
    gitMock.mockReset()
    gitScalarMock.mockReset()
    gitLookupMock.mockReset()
  })

  test('reads and filters remote-tracking refs', async () => {
    const signal = new AbortController().signal
    gitMock.mockImplementation(async (_cwd: string, args: string[]) =>
      args[0] === 'remote'
        ? 'origin'
        : 'refs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/feature/a\n',
    )
    gitScalarMock.mockResolvedValue('https://example.test/repo.git')
    gitLookupMock.mockResolvedValue('+refs/heads/*:refs/remotes/origin/*')

    await expect(getRemoteTrackingBranches('/repo', signal)).resolves.toEqual([
      { ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' },
      { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
    ])
    expect(gitMock).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname)', 'refs/remotes/'], {
      signal,
    })
    expect(gitLookupMock).toHaveBeenCalledWith('/repo', ['config', '--get-all', '--', 'remote.origin.fetch'], {
      signal,
    })
    expect(gitMock).toHaveBeenCalledWith('/repo', ['remote'], { signal })
    expect(gitScalarMock).toHaveBeenCalledWith('/repo', ['remote', 'get-url', '--', 'origin'], { signal })
    expect(gitScalarMock).toHaveBeenCalledWith('/repo', ['remote', 'get-url', '--push', '--', 'origin'], { signal })
    expect(gitMock).toHaveBeenCalledTimes(2)
    expect(gitScalarMock).toHaveBeenCalledTimes(2)
    expect(gitLookupMock).toHaveBeenCalledOnce()
  })

  test('propagates failure from the authoritative git read', async () => {
    gitMock.mockRejectedValue(new Error('boom'))

    await expect(getRemoteTrackingBranches('/repo')).rejects.toThrow('boom')
  })
})
