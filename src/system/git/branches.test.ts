import { describe, expect, test, vi } from 'vitest'
import { realpath } from 'node:fs/promises'
import { getBranchWorktreeIdentities, resolveRepoCommonDir, resolveRepoObjectsDir } from '#/system/git/branches.ts'
import { git } from '#/system/git/git-exec.ts'

vi.mock('#/system/git/git-exec.ts', () => ({
  git: vi.fn(),
  gitResultWithOptions: vi.fn(),
  NETWORK_TIMEOUT_MS: 30_000,
}))

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(),
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
      { kind: 'git-worktree', worktreePath: '/repo', head: { kind: 'branch', branchName: 'main' } },
      {
        kind: 'git-worktree',
        worktreePath: '/worktrees/linked',
        head: { kind: 'branch', branchName: 'feature/linked' },
      },
      { kind: 'git-branch', branchName: 'feature/free' },
    ])
    expect(git).toHaveBeenCalledWith('/repo', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
      signal: undefined,
    })
  })

  test('does not turn a failed authority read into an empty catalog', async () => {
    vi.mocked(git).mockRejectedValueOnce(new Error('git unavailable'))
    await expect(getBranchWorktreeIdentities('/repo', [])).rejects.toThrow('git unavailable')
  })

  test('keeps a detached local worktree without a branch ref', async () => {
    vi.mocked(git).mockResolvedValueOnce('')
    await expect(
      getBranchWorktreeIdentities('/repo', [{ path: '/repo', isBare: false, isPrimary: true }]),
    ).resolves.toEqual([{ kind: 'git-worktree', worktreePath: '/repo', head: { kind: 'detached' } }])
  })
})

describe('repository common directory', () => {
  test('normalizes a confirmed common directory', async () => {
    vi.mocked(git).mockResolvedValueOnce('../.git')
    vi.mocked(realpath).mockResolvedValueOnce('/physical/repo/.git')

    await expect(resolveRepoCommonDir('/repo/worktree')).resolves.toBe('/physical/repo/.git')
    expect(realpath).toHaveBeenCalledWith('/repo/.git')
  })

  test('collapses filesystem aliases onto one physical common directory', async () => {
    vi.mocked(git).mockResolvedValue('.git')
    vi.mocked(realpath).mockResolvedValue('/physical/repo/.git')

    const direct = await resolveRepoCommonDir('/repo')
    const alias = await resolveRepoCommonDir('/alias')

    expect(direct).toBe(alias)
    expect(realpath).toHaveBeenNthCalledWith(1, '/repo/.git')
    expect(realpath).toHaveBeenNthCalledWith(2, '/alias/.git')
  })

  test('preserves authority read failures for strict callers', async () => {
    vi.mocked(git).mockRejectedValueOnce(new Error('git unavailable'))

    await expect(resolveRepoCommonDir('/repo')).rejects.toThrow('git unavailable')
  })
})

describe('repository objects directory', () => {
  test('resolves the effective object store through Git', async () => {
    vi.mocked(git).mockResolvedValueOnce('../../object-store')
    vi.mocked(realpath).mockResolvedValueOnce('/physical/object-store')

    await expect(resolveRepoObjectsDir('/repo/worktree')).resolves.toBe('/physical/object-store')
    expect(git).toHaveBeenCalledWith('/repo/worktree', ['rev-parse', '--git-path', 'objects'], { signal: undefined })
    expect(realpath).toHaveBeenCalledWith('/object-store')
  })
})
