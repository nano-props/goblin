import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createWorktree, readWorktreeMembership, removeWorktree } from '#/system/git/worktrees.ts'
import type * as GitExecModule from '#/system/git/git-exec.ts'

const gitCommandResultWithOptionsMock = vi.hoisted(() => vi.fn())
const gitMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', async () => {
  const actual = await vi.importActual<typeof GitExecModule>('#/system/git/git-exec.ts')
  return {
    ...actual,
    git: gitMock,
    gitCommandResultWithOptions: vi.fn((cwd: string, opts: unknown, ...args: string[]) =>
      gitCommandResultWithOptionsMock(cwd, opts, ...args),
    ),
  }
})

describe('worktree git operations', () => {
  beforeEach(() => {
    gitCommandResultWithOptionsMock.mockReset()
    gitCommandResultWithOptionsMock.mockResolvedValue({
      result: { ok: false, message: 'cancelled' },
      execution: { status: 'cancelled' },
    })
    gitMock.mockReset()
  })

  test.each([
    [
      'newBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch' as const, newBranch: 'feature/branch', baseRef: 'main' },
      },
      ['worktree', 'add', '-b', 'feature/branch', '--', '/tmp/repo-feature', 'main'],
    ],
    [
      'existingBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'existingBranch' as const, branch: 'feature/branch' },
      },
      ['worktree', 'add', '--', '/tmp/repo-feature', 'feature/branch'],
    ],
    [
      'trackRemoteBranch',
      {
        worktreePath: '/tmp/repo-feature',
        mode: {
          kind: 'trackRemoteBranch' as const,
          remote: {
            ref: 'refs/remotes/origin/feature/branch',
            remote: 'origin',
            branch: 'feature/branch',
          },
          localBranch: 'feature/branch',
        },
      },
      [
        'worktree',
        'add',
        '-b',
        'feature/branch',
        '--track',
        '--',
        '/tmp/repo-feature',
        'refs/remotes/origin/feature/branch',
      ],
    ],
  ])(
    'delegates %s createWorktree to git worktree add with the shared timeout and signal',
    async (_name, input, expectedArgs) => {
      const signal = new AbortController().signal

      const result = await createWorktree('/tmp/repo', input, signal)

      expect(result).toEqual({
        result: { ok: false, message: 'cancelled' },
        execution: { status: 'cancelled' },
      })
      expect(gitCommandResultWithOptionsMock).toHaveBeenCalledWith(
        '/tmp/repo',
        { timeoutMs: 300_000, signal },
        ...expectedArgs,
      )
    },
  )

  test('keeps create timeout execution facts separate from the raw command error', async () => {
    gitCommandResultWithOptionsMock.mockResolvedValueOnce({
      result: { ok: false, message: 'git timed out after 300s' },
      execution: { status: 'timed-out' },
    })

    const result = await createWorktree('/tmp/repo', {
      worktreePath: '/tmp/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/branch' },
    })

    expect(result).toEqual({
      result: { ok: false, message: 'git timed out after 300s' },
      execution: { status: 'timed-out' },
    })
  })

  test('delegates removeWorktree to git worktree remove with the shared timeout and signal', async () => {
    const signal = new AbortController().signal

    const result = await removeWorktree('/tmp/repo', '/tmp/repo-feature', signal)

    expect(result).toEqual({ result: { ok: false, message: 'cancelled' }, execution: { status: 'cancelled' } })
    expect(gitCommandResultWithOptionsMock).toHaveBeenCalledWith(
      '/tmp/repo',
      { timeoutMs: 300_000, signal },
      'worktree',
      'remove',
      '--',
      '/tmp/repo-feature',
    )
  })

  test('keeps remove timeout execution facts separate from the raw command error', async () => {
    gitCommandResultWithOptionsMock.mockResolvedValueOnce({
      result: { ok: false, message: 'git timed out after 300s' },
      execution: { status: 'timed-out' },
    })

    const result = await removeWorktree('/tmp/repo', '/tmp/repo-feature')

    expect(result).toEqual({
      result: { ok: false, message: 'git timed out after 300s' },
      execution: { status: 'timed-out' },
    })
  })

  test('does not turn a failed authoritative worktree-list read into an empty repository', async () => {
    gitMock.mockRejectedValue(new Error('git unavailable'))

    await expect(readWorktreeMembership('/tmp/repo')).rejects.toThrow('git unavailable')
  })
})
