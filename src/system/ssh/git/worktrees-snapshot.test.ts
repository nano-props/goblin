import { describe, expect, test, vi } from 'vitest'
import { getRemoteRepoWorktreePaths, resolveRemoteWorktreePath } from '#/system/ssh/git/worktrees.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { TARGET, failRemoteResult, okRemoteResult } from '#/system/ssh/git/test-utils.ts'

describe('remote Git worktree reads', () => {
  test('rejects failed authoritative worktree-path discovery', async () => {
    const run = vi.fn<RemoteCommandRunner>(async () => failRemoteResult('worktree discovery failed'))

    await expect(getRemoteRepoWorktreePaths(TARGET, { run })).rejects.toThrow('worktree discovery failed')
  })

  test('resolves a created worktree through the remote Git root boundary', async () => {
    const run = vi.fn<RemoteCommandRunner>(async (command) =>
      command.type === 'revParseTopLevel' ? okRemoteResult('/srv/feature\n') : failRemoteResult('unexpected'),
    )

    await expect(resolveRemoteWorktreePath(TARGET, '/srv/nested/../feature', { run })).resolves.toBe('/srv/feature')
    expect(run).toHaveBeenCalledWith({ type: 'revParseTopLevel', path: '/srv/nested/../feature' }, TARGET, {
      signal: undefined,
    })
  })
})
