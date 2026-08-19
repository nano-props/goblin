import { describe, expect, test, vi } from 'vitest'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import { deleteRemoteBranch, pullRemoteBranch } from '#/system/ssh/git/branches.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import {
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  NUL,
  PRIMARY_WORKTREE_OUTPUT,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
  worktreePorcelain,
} from '#/system/ssh/git/test-utils.ts'

describe('remote Git branch network operations', () => {
  test('pullRemoteBranch reports missing upstream remote explicitly', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command: { type: string; attachedBranch?: string | null }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'feature/test'))
        case 'gitRemotes':
          return okRemoteResult('origin\0git@github.com:acme/project.git\0git@github.com:acme/project.git\0')
        case 'gitWorktreeList':
          return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'gitOperationState':
          return okRemoteResult(`operation none\nmaterialized-branch ${command.attachedBranch ?? ''}\n`)
        case 'gitStatus':
          return okRemoteResult('')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pullRemoteBranch(TARGET, 'feature/test', undefined, { run: run })

    expect(result).toEqual(commandOutcomeForTest({ ok: false, message: 'error.pull-no-remote' }, 'not-started'))
  })

  test('pullRemoteBranch reports possible filesystem impact when the start marker was not observed', async () => {
    const run = vi.fn<RemoteCommandRunner>(async () => failRemoteResult('connection failed'))

    const result = await pullRemoteBranch(TARGET, 'feature/test', '/srv/repo-feature', { run })

    expect(result).toEqual(
      commandOutcomeForTest(
        {
          ok: false,
          message: 'connection failed',
          worktreePathsToInvalidate: ['/srv/repo-feature'],
        },
        'failed',
      ),
    )
  })

  test('deleteRemoteBranch rejects merge-fact failure before deleting', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
      }
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain(
            'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/main',
          ),
        )
      }
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitOperationState') {
        return okRemoteResult(`operation none\nmaterialized-branch ${command.attachedBranch ?? ''}\n`)
      }
      if (command.type === 'gitUpstream') return okRemoteResult(NUL.repeat(3))
      if (command.type === 'gitIsAncestor') return failRemoteResult('merge read failed')
      return okRemoteResult('')
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/test', run })).rejects.toThrow('merge read failed')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })

  test('deleteRemoteBranch rejects malformed merge-fact output before deleting', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
      }
      if (command.type === 'gitIsAncestor') return okRemoteResult('unknown')
      return okRemoteResult('')
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/test', run })).rejects.toThrow('error.failed-read-repo')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })
})
