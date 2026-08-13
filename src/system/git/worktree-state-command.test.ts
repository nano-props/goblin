import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ git: vi.fn() }))

vi.mock('#/system/git/git-exec.ts', () => ({ git: mocks.git }))

beforeEach(() => {
  mocks.git.mockReset()
})

describe('readGitWorktreeState administrative paths', () => {
  test('resolves every operation marker with one Git invocation', async () => {
    mocks.git.mockResolvedValueOnce(
      [
        '.git/rebase-merge',
        '.git/rebase-apply',
        '.git/CHERRY_PICK_HEAD',
        '.git/REVERT_HEAD',
        '.git/BISECT_LOG',
        '.git/BISECT_START',
        '.git/MERGE_HEAD',
      ].join('\n'),
    )
    const { readGitWorktreeState } = await import('#/system/git/worktree-state.ts')

    await expect(readGitWorktreeState('/repo', '/repo/.git/worktrees/feature')).resolves.toEqual({
      operation: null,
      materializedBranch: null,
    })
    expect(mocks.git).toHaveBeenCalledOnce()
    expect(mocks.git).toHaveBeenCalledWith(
      '/repo',
      [
        '--git-dir',
        '/repo/.git/worktrees/feature',
        'rev-parse',
        '--git-path',
        'rebase-merge',
        '--git-path',
        'rebase-apply',
        '--git-path',
        'CHERRY_PICK_HEAD',
        '--git-path',
        'REVERT_HEAD',
        '--git-path',
        'BISECT_LOG',
        '--git-path',
        'BISECT_START',
        '--git-path',
        'MERGE_HEAD',
      ],
      { signal: undefined },
    )
  })

  test('rejects incomplete administrative path output', async () => {
    mocks.git.mockResolvedValueOnce(['.git/rebase-merge', '.git/rebase-apply', '.git/CHERRY_PICK_HEAD'].join('\n'))
    const { readGitWorktreeState } = await import('#/system/git/worktree-state.ts')

    await expect(readGitWorktreeState('/repo', '/repo/.git')).rejects.toThrow(
      'Git returned 3 administrative paths; expected 7',
    )
  })

  test('preserves Git command failures', async () => {
    mocks.git.mockRejectedValueOnce(new Error('rev-parse failed'))
    const { readGitWorktreeState } = await import('#/system/git/worktree-state.ts')

    await expect(readGitWorktreeState('/repo', '/repo/.git')).rejects.toThrow('rev-parse failed')
  })
})
