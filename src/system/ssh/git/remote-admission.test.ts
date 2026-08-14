import { describe, expect, test, vi } from 'vitest'
import { pullRemoteBranch } from '#/system/ssh/git/branches.ts'
import { pushRemoteBranch } from '#/system/ssh/git/remote.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import {
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  PRIMARY_WORKTREE_OUTPUT,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
} from '#/system/ssh/git/test-utils.ts'

describe('remote Git mutation admission', () => {
  test.each(['pullRemoteBranch', 'pushRemoteBranch'] as const)(
    '%s rejects remote discovery failure before mutation',
    async (operationName) => {
      const run = vi.fn<RemoteCommandRunner>(async (command) => {
        if (command.type === 'gitSnapshot') return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        if (command.type === 'gitUpstream') return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        if (command.type === 'gitRemoteVerbose') return failRemoteResult('remote discovery failed')
        if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        return okRemoteResult('')
      })
      const operation =
        operationName === 'pullRemoteBranch'
          ? pullRemoteBranch(TARGET, 'feature/test', undefined, { run })
          : pushRemoteBranch(TARGET, 'feature/test', { run })

      await expect(operation).rejects.toThrow('remote discovery failed')
      expect(run).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: expect.stringMatching(/^git(?:FetchBranch|Push)$/) }),
        TARGET,
        expect.anything(),
      )
    },
  )
})
