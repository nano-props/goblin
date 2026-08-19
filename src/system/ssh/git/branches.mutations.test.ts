import { describe, expect, test, vi } from 'vitest'
import { deleteRemoteBranch } from '#/system/ssh/git/branches.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import {
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  NUL,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
  worktreePorcelain,
} from '#/system/ssh/git/test-utils.ts'

describe('remote Git branch mutations', () => {
  test('deleteRemoteBranch allows safe delete when branch is merged into current HEAD without upstream', async () => {
    const run = vi.fn<RemoteCommandRunner>(
      async (command: {
        type: string
        ancestor?: string
        descendant?: string
        branch?: string
        attachedBranch?: string | null
      }) => {
        switch (command.type) {
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'value release/1.0',
                '__GOBLIN_REMOTE_DEFAULT__',
                'value main',
                '__GOBLIN_REMOTE_BRANCHES__',
                'release/1.0\x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x00aaaaaaa\x00Release\x002024-01-01T00:00:00Z\x00Alice\x00origin/release/1.0\x00',
                'feature/test\x00ba5eba1000000000000000000000000000000000\x00ba5eba1\x00Feature\x002024-01-02T00:00:00Z\x00Alice\x00\x00',
              ].join('\n'),
            )
          case 'gitWorktreeList':
            return okRemoteResult(
              worktreePorcelain(
                'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/release/1.0',
              ),
            )
          case 'resolveRepoCommonDir':
            return okRemoteResult('/srv/repo/.git\0')
          case 'gitOperationState':
            return okRemoteResult(`operation none\nmaterialized-branch ${command.attachedBranch ?? ''}\n`)
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitRemotes':
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
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
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
          return okRemoteResult(
            worktreePorcelain(
              'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/release/1.0',
            ),
          )
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'gitOperationState':
          return okRemoteResult(`operation none\nmaterialized-branch ${command.attachedBranch ?? ''}\n`)
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

  test('deleteRemoteBranch rejects a branch retained by a rebasing worktree before mutation', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
          )
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'gitOperationState':
          return okRemoteResult('operation rebase\nmaterialized-branch refs/heads/feature/test\n')
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
          case 'gitRemotes':
          return okRemoteResult('')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, { branch: 'feature/test', force: true, run })

    expect(result).toEqual({ ok: false, message: 'error.cannot-delete-checked-out-branch', branchEffect: 'none' })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })

  test('deleteRemoteBranch reports an uncertain result after timeout', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
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
          return okRemoteResult(
            worktreePorcelain(
              'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/release/1.0',
            ),
          )
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'gitOperationState':
          return okRemoteResult(`operation none\nmaterialized-branch ${command.attachedBranch ?? ''}\n`)
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
    const run = vi.fn<RemoteCommandRunner>(async (command: { type: string; attachedBranch?: string | null }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'release/1.0\x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x00aaaaaaa\x00Release\x002024-01-01T00:00:00Z\x00Alice\x00origin/release/1.0\x00',
              `feature/test\x00ba5eba1000000000000000000000000000000000\x00ba5eba1\x00Feature\x002024-01-02T00:00:00Z\x00Alice\x00${remote}/${upstreamBranch}\x00`,
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain(
              'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/release/1.0',
            ),
          )
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'gitOperationState':
          return okRemoteResult(`operation none\nmaterialized-branch ${command.attachedBranch ?? ''}\n`)
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
})
