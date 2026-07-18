import { describe, expect, test, vi } from 'vitest'
import { getBranchWorktreeIdentities } from '#/system/git/branches.ts'
import { git } from '#/system/git/git-exec.ts'

vi.mock('#/system/git/git-exec.ts', () => ({
  git: vi.fn(),
  gitResultWithOptions: vi.fn(),
  NETWORK_TIMEOUT_MS: 30_000,
}))

describe('getBranchWorktreeIdentities', () => {
  test('reads strict branch identity and maps known worktree paths', async () => {
    vi.mocked(git).mockResolvedValueOnce('main\nfeature/linked\nfeature/free\n')

    await expect(
      getBranchWorktreeIdentities('/repo', [
        { path: '/repo', branch: 'main', isBare: false, isPrimary: true },
        { path: '/worktrees/linked', branch: 'feature/linked', isBare: false, isPrimary: false },
      ]),
    ).resolves.toEqual([
      { branch: 'main', worktreePath: '/repo' },
      { branch: 'feature/linked', worktreePath: '/worktrees/linked' },
      { branch: 'feature/free', worktreePath: null },
    ])
    expect(git).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
      signal: undefined,
    })
  })

  test('does not turn a failed authority read into an empty catalog', async () => {
    vi.mocked(git).mockRejectedValueOnce(new Error('git unavailable'))
    await expect(getBranchWorktreeIdentities('/repo', [])).rejects.toThrow('git unavailable')
  })
})
