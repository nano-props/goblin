import { describe, expect, test, vi } from 'vitest'
import {
  createRemoteWorktree,
  deleteRemoteBranch,
  removeRemoteWorktree,
  type RemoteGitRunner,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import {
  LINKED_TARGET,
  MAIN_AND_LINKED_WORKTREES_OUTPUT,
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  NUL,
  SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
  worktreePorcelain,
} from '#/system/ssh/git-test-utils.ts'

describe('remote git mutations', () => {
  test('deleteRemoteBranch allows safe delete when branch is merged into current HEAD without upstream', async () => {
    const run = vi.fn<RemoteGitRunner>(
      async (command: { type: string; ancestor?: string; descendant?: string; branch?: string }) => {
        switch (command.type) {
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'value release/1.0',
                '__GOBLIN_REMOTE_DEFAULT__',
                'value main',
                '__GOBLIN_REMOTE_BRANCHES__',
                'release/1.0\x00f00ba4000000000000000000000000000000000\x00f00ba40\x00Release\x002024-01-01T00:00:00Z\x00Alice\x00origin/release/1.0\x00',
                'feature/test\x00ba5eba1000000000000000000000000000000000\x00ba5eba1\x00Feature\x002024-01-02T00:00:00Z\x00Alice\x00\x00',
              ].join('\n'),
            )
          case 'gitWorktreeList':
            return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/release/1.0'))
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitRemoteVerbose':
            return okRemoteResult('')
          case 'gitIsAncestor':
            return okRemoteResult(command.descendant === 'release/1.0' ? 'true' : 'false')
          case 'gitUpstream':
            return okRemoteResult(NUL.repeat(3))
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          default:
            return okRemoteResult('')
        }
      },
    )

    const result = await deleteRemoteBranch(TARGET, { branch: 'feature/test', run: run })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      branchEffect: 'local-delete-confirmed',
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitIsAncestor', path: '/srv/repo', ancestor: 'feature/test', descendant: 'release/1.0' },
      TARGET,
      { signal: undefined },
    )
  })

  test('deleteRemoteBranch does not query ancestry against a missing tracking ref', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/release/1.0'))
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test', ''))
        case 'gitIsAncestor':
          return command.descendant === 'release/1.0'
            ? okRemoteResult('false')
            : failRemoteResult('missing tracking ref reached ancestry check')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, { branch: 'feature/test', run })

    expect(result).toEqual({ ok: false, message: 'error.branch-not-fully-merged', branchEffect: 'none' })
    expect(run.mock.calls.filter(([command]) => command.type === 'gitIsAncestor')).toHaveLength(1)
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })

  test('deleteRemoteBranch reports an uncertain result after timeout', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/release/1.0'))
        case 'gitUpstream':
          return okRemoteResult(NUL.repeat(3))
        case 'gitIsAncestor':
          return okRemoteResult('true')
        case 'gitBranchDelete':
          return { ...failRemoteResult('timeout'), timedOut: true, remoteStarted: true }
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, { branch: 'feature/test', run })

    expect(result).toEqual({
      ok: false,
      message: 'timeout',
      branchEffect: 'may-have-changed',
      failureExecution: { status: 'timed-out' },
    })
  })

  test.each([
    {
      name: 'deletes the configured upstream when requested',
      remote: 'fork',
      upstreamBranch: 'topic/feature-test',
      pushResult: okRemoteResult('deleted upstream'),
      expected: { ok: true, message: 'deleted upstream', branchEffect: 'local-delete-confirmed' },
    },
    {
      name: 'reports upstream delete failure after deleting the local branch',
      remote: 'origin',
      upstreamBranch: 'feature/test',
      pushResult: { ...failRemoteResult('remote rejected delete'), remoteStarted: true },
      expected: {
        ok: false,
        message: 'remote rejected delete',
        branchEffect: 'local-delete-confirmed',
        failureExecution: { status: 'failed' },
      },
    },
  ] as const)('deleteRemoteBranch $name', async ({ remote, upstreamBranch, pushResult, expected }) => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'release/1.0\x00f00ba4000000000000000000000000000000000\x00f00ba40\x00Release\x002024-01-01T00:00:00Z\x00Alice\x00origin/release/1.0\x00',
              `feature/test\x00ba5eba1000000000000000000000000000000000\x00ba5eba1\x00Feature\x002024-01-02T00:00:00Z\x00Alice\x00${remote}/${upstreamBranch}\x00`,
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/release/1.0'))
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return okRemoteResult('true')
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput(remote, upstreamBranch))
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        case 'gitPushDeleteBranch':
          return pushResult
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, {
      branch: 'feature/test',
      deleteUpstream: true,
      run: run,
    })

    expect(result).toEqual(expected)
    expect(run).toHaveBeenCalledWith(
      { type: 'gitPushDeleteBranch', path: '/srv/repo', remote, branch: upstreamBranch },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run.mock.calls.filter(([command]) => command.type === 'gitUpstream')).toHaveLength(1)
  })

  test('removeRemoteWorktree allows deleting branch when merged into current HEAD without upstream', async () => {
    const run = vi.fn<RemoteGitRunner>(
      async (command: {
        type: string
        descendant?: string
        worktreePath?: string
        branch?: string
        force?: boolean
      }) => {
        switch (command.type) {
          case 'gitWorktreeList':
            return okRemoteResult(
              [
                'worktree /srv/repo',
                'HEAD f00ba40',
                'branch refs/heads/release/1.0',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join(NUL) +
                NUL +
                NUL,
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'value release/1.0',
                '__GOBLIN_REMOTE_DEFAULT__',
                'value main',
                '__GOBLIN_REMOTE_BRANCHES__',
                '',
              ].join('\n'),
            )
          case 'gitIsAncestor':
            return okRemoteResult(command.descendant === 'release/1.0' ? 'true' : 'false')
          case 'gitUpstream':
            return okRemoteResult(NUL.repeat(3))
          case 'gitWorktreeRemove':
            return okRemoteResult('Removed worktree')
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          default:
            return okRemoteResult('true')
        }
      },
    )

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
      worktreeRemoved: true,
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      TARGET,
      { signal: undefined, timeoutMs: 300_000 },
    )
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchDelete', path: '/srv/repo', branch: 'feature/test', force: false },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('removeRemoteWorktree refuses safely without querying a missing tracking ref', async () => {
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test', ''))
        case 'gitIsAncestor':
          return command.descendant === 'main'
            ? okRemoteResult('false')
            : failRemoteResult('missing tracking ref reached ancestry check')
        default:
          return okRemoteResult('')
      }
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove,
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })
    expect(run.mock.calls.filter(([command]) => command.type === 'gitIsAncestor')).toHaveLength(1)
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeRemove' }),
      TARGET,
      expect.anything(),
    )
  })

  test('removeRemoteWorktree resolves equivalent absolute worktree paths', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitWorktreeRemove':
          return okRemoteResult('Removed worktree')
        default:
          return okRemoteResult('')
      }
    })

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/./repo-feature/',
      deleteBranch: false,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Removed worktree',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
      worktreeRemoved: true,
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      TARGET,
      { timeoutMs: 300_000 },
    )
  })

  test('removeRemoteWorktree rejects relative worktree paths before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: 'repo-feature',
      deleteBranch: false,
      run: run,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(run).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree preserves status read failure at destructive admission', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
      }
      if (command.type === 'gitStatus') return failRemoteResult('status unavailable')
      return failRemoteResult('unexpected mutation')
    })

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: false,
      run,
    })

    expect(result).toEqual({ ok: false, message: 'status unavailable' })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeRemove' }),
      TARGET,
      expect.anything(),
    )
  })

  test('removeRemoteWorktree reports uncertainty and impact after a started timeout', async () => {
    const afterWorktreeRemoved = vi.fn(async () => ({ ok: true as const, message: '' }))
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
      if (command.type === 'gitStatus') return okRemoteResult('')
      if (command.type === 'gitWorktreeRemove') {
        return {
          ok: false,
          stdout: '',
          stderr: '',
          message: 'timeout',
          timedOut: true,
          remoteStarted: true,
        }
      }
      return failRemoteResult('unexpected command')
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: false,
      run,
    })

    expect(result).toEqual({
      ok: false,
      message: 'timeout',
      failureExecution: { status: 'timed-out' },
      failureStage: 'worktree-remove',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(afterWorktreeRemoved).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree treats an unobserved start marker as uncertain mutation impact', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
      if (command.type === 'gitStatus') return okRemoteResult('')
      if (command.type === 'gitWorktreeRemove') return failRemoteResult('connection failed')
      return failRemoteResult('unexpected command')
    })

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: false,
      run,
    })

    expect(result).toEqual({
      ok: false,
      message: 'connection failed',
      failureExecution: { status: 'failed' },
      failureStage: 'worktree-remove',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
    })
  })

  test('removeRemoteWorktree omits mutation impact when SSH provably did not start', async () => {
    const afterWorktreeRemoved = vi.fn(async () => ({ ok: true as const, message: '' }))
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
      if (command.type === 'gitStatus') return okRemoteResult('')
      if (command.type === 'gitWorktreeRemove') {
        return {
          ok: false,
          stdout: '',
          stderr: '',
          message: 'ssh executable was not found',
          commandNotStarted: true,
        }
      }
      return failRemoteResult('unexpected command')
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: false,
      run,
    })

    expect(result).toEqual({
      ok: false,
      message: 'ssh executable was not found',
      failureExecution: { status: 'not-started' },
      failureStage: 'worktree-remove',
    })
    expect(afterWorktreeRemoved).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree rejects an equivalent path to the primary worktree', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main'))
      }
      return okRemoteResult('')
    })

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'main',
      worktreePath: '/srv/./repo/',
      deleteBranch: false,
      run: run,
    })

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-main-worktree' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('removeRemoteWorktree deletes the configured upstream after worktree and branch deletion', async () => {
    const run = vi.fn<RemoteGitRunner>(
      async (command: {
        type: string
        descendant?: string
        worktreePath?: string
        branch?: string
        force?: boolean
      }) => {
        switch (command.type) {
          case 'gitWorktreeList':
            return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
          case 'gitIsAncestor':
            return okRemoteResult('true')
          case 'gitUpstream':
            return okRemoteResult(upstreamOutput('fork', 'topic/feature-test'))
          case 'gitWorktreeRemove':
            return okRemoteResult('Removed worktree')
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          case 'gitPushDeleteBranch':
            return okRemoteResult('deleted upstream')
          default:
            return okRemoteResult('')
        }
      },
    )

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      deleteUpstream: true,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'deleted upstream',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
      worktreeRemoved: true,
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitPushDeleteBranch', path: '/srv/repo', remote: 'fork', branch: 'topic/feature-test' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run.mock.calls.filter(([command]) => command.type === 'gitUpstream')).toHaveLength(1)
  })

  test('removeRemoteWorktree surfaces recovery when upstream cleanup is cancelled after removal', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        case 'gitIsAncestor':
          return okRemoteResult('true')
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        case 'gitWorktreeRemove':
          return okRemoteResult('Removed worktree')
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        case 'gitPushDeleteBranch':
          return failRemoteResult('cancelled')
        default:
          return okRemoteResult('')
      }
    })

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      deleteUpstream: true,
      run,
    })

    expect(result).toEqual({
      ok: false,
      message: 'cancelled',
      branchEffect: 'local-delete-confirmed',
      failureExecution: { status: 'cancelled' },
      failureStage: 'branch-delete',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
      worktreeRemoved: true,
    })
  })

  test('removeRemoteWorktree resolves the upstream before any mutation', async () => {
    const beforeRemove = vi.fn(async () => ({ ok: true, message: '' }))
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
      }
      if (command.type === 'gitStatus') return okRemoteResult('')
      if (command.type === 'gitUpstream') return failRemoteResult('upstream read failed')
      return okRemoteResult('')
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        beforeRemove,
        afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
        branch: 'feature/test',
        worktreePath: '/srv/repo-feature',
        deleteBranch: true,
        deleteUpstream: true,
        run,
      }),
    ).rejects.toThrow('upstream read failed')
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeRemove' }),
      TARGET,
      expect.anything(),
    )
  })

  test('removeRemoteWorktree rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test;echo bad',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree removes the currently opened linked worktree from the primary path', async () => {
    const run = vi.fn<RemoteGitRunner>(
      async (command: {
        type: string
        path?: string
        descendant?: string
        worktreePath?: string
        branch?: string
        force?: boolean
      }) => {
        switch (command.type) {
          case 'gitWorktreeList':
            return okRemoteResult(MAIN_AND_LINKED_WORKTREES_OUTPUT)
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return command.path === '/srv/repo'
              ? okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
              : failRemoteResult('removed cwd should not be used')
          case 'gitIsAncestor':
            return command.path === '/srv/repo' && command.descendant === 'main'
              ? okRemoteResult('true')
              : okRemoteResult('false')
          case 'gitUpstream':
            return okRemoteResult(NUL.repeat(3))
          case 'gitWorktreeRemove':
            return okRemoteResult('Removed worktree')
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          default:
            return okRemoteResult('')
        }
      },
    )

    const result = await removeRemoteWorktree(LINKED_TARGET, {
      ...SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
      worktreeRemoved: true,
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitSnapshot', path: '/srv/repo' }, LINKED_TARGET, { signal: undefined })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      LINKED_TARGET,
      { signal: undefined, timeoutMs: 300_000 },
    )
    expect(run).toHaveBeenCalledWith(
      { type: 'gitBranchDelete', path: '/srv/repo', branch: 'feature/test', force: false },
      LINKED_TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('createRemoteWorktree rejects relative paths before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>()

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/test', baseRef: 'main' },
      run: run,
    })

    expect(result).toEqual({
      result: { ok: false, message: 'error.invalid-path' },
      execution: { status: 'not-started' },
    })
    expect(run).not.toHaveBeenCalled()
  })

  test('createRemoteWorktree uses the worktree operation timeout', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult('Created worktree'))
    const input = {
      worktreePath: '/srv/repo-feature',
      mode: { kind: 'newBranch' as const, newBranch: 'feature/test', baseRef: 'main' },
    }

    const result = await createRemoteWorktree(TARGET, { ...input, run })

    expect(result).toEqual({
      result: {
        ok: true,
        message: 'Created worktree',
        worktreePathsToInvalidate: ['/srv/repo-feature'],
      },
      execution: { status: 'succeeded' },
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitWorktreeAdd', path: '/srv/repo', input }, TARGET, {
      signal: undefined,
      timeoutMs: 300_000,
    })
  })

  test('createRemoteWorktree reports uncertain state when a started remote command times out', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => ({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'timeout',
      timedOut: true,
      remoteStarted: true,
    }))

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: '/srv/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/test' },
      run,
    })

    expect(result).toEqual({
      result: { ok: false, message: 'timeout' },
      execution: { status: 'timed-out' },
    })
  })

  test('createRemoteWorktree keeps timeout uncertain when the start marker was not observed', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => ({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'timeout',
      timedOut: true,
      remoteStarted: false,
    }))

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: '/srv/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/test' },
      run,
    })

    expect(result).toEqual({
      result: { ok: false, message: 'timeout' },
      execution: { status: 'timed-out' },
    })
  })

  test('createRemoteWorktree preserves proof that SSH was not invoked', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => ({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'cancelled',
      commandNotStarted: true,
    }))

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: '/srv/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/test' },
      run,
    })

    expect(result).toEqual({
      result: { ok: false, message: 'cancelled' },
      execution: { status: 'not-started' },
    })
  })

  test('createRemoteWorktree treats an unconfirmed remote protocol start as a failed attempt', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => ({
      ok: false,
      stdout: '',
      stderr: '',
      message: 'remote command execution could not be confirmed',
      remoteStarted: false,
      remoteStartUnconfirmed: true,
    }))

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: '/srv/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/test' },
      run,
    })

    expect(result).toEqual({
      result: { ok: false, message: 'remote command execution could not be confirmed' },
      execution: { status: 'remote-start-unconfirmed' },
    })
  })
})
