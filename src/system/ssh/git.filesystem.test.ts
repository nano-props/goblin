import { describe, expect, test, vi } from 'vitest'
import {
  getRemoteTreeWalk,
  remoteCommandExists,
  remoteCommandExistsAtWorkspaceRoot,
  type RemoteGitRunner,
  resolveRemoteWorktree,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { NUL, TARGET, failRemoteResult, okRemoteResult } from '#/system/ssh/git-test-utils.ts'

describe('remote git filesystem', () => {
  test('skips gitWorktreeList when knownWorktrees is supplied', async () => {
    // A caller that already resolved membership must not pay for another
    // `gitWorktreeList` SSH call.
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      const NUL = String.fromCharCode(0)
      switch (command.type) {
        case 'gitDirectoryChildren':
          return okRemoteResult(`/srv/repo-feature/README.md${NUL}/srv/repo-feature/src/foo.ts`)
        default:
          return failRemoteResult('should not be called')
      }
    })

    const result = await getRemoteTreeWalk(TARGET, '/srv/repo-feature', {
      run: run,
      knownWorktrees,
    })

    expect(result).toMatchObject({ ok: true })
    const treeWalkCall = run.mock.calls.find(([command]) => command.type === 'gitDirectoryChildren')
    expect(treeWalkCall).toBeDefined()
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeList' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('reads the authoritative worktree list when no prefetched list is supplied', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(
            [
              'worktree /srv/repo-feature',
              'HEAD aaaaaaa000000000000000000000000000000000',
              'branch refs/heads/feat',
            ].join(NUL) +
              NUL +
              NUL,
          )
        case 'gitDirectoryChildren':
          return okRemoteResult('')
        default:
          return failRemoteResult('unexpected')
      }
    })

    const result = await getRemoteTreeWalk(TARGET, '/srv/repo-feature', { run: run })

    expect(result).toMatchObject({ ok: true })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeList' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('rejects a request for an unknown worktree path even when knownWorktrees is supplied', async () => {
    const knownWorktrees: WorktreeInfo[] = [{ path: '/srv/repo', branch: 'main', isBare: false, isPrimary: true }]
    const run = vi.fn<RemoteGitRunner>()
    const result = await getRemoteTreeWalk(TARGET, '/srv/repo-missing', {
      run: run,
      knownWorktrees,
    })
    expect(result).toEqual({ ok: false, message: 'error.worktree-not-found' })
    expect(run).not.toHaveBeenCalled()
  })

  test('returns the canonical known worktree path after POSIX normalization', async () => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn<RemoteGitRunner>()

    const result = await resolveRemoteWorktree(TARGET, '/srv/repo-feature/', {
      run: run,
      knownWorktrees,
    })

    expect(result).toEqual(knownWorktrees[0])
    expect(run).not.toHaveBeenCalled()
  })

  test('throws the remote read failure instead of returning an empty authority set', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => failRemoteResult('ssh unavailable'))

    await expect(resolveRemoteWorktree(TARGET, '/srv/repo-feature', { run: run })).rejects.toThrow('ssh unavailable')

    expect(run).toHaveBeenCalledWith({ type: 'gitWorktreeList', path: '/srv/repo' }, TARGET, { signal: undefined })
  })

  test('checks an explicitly authorized workspace root without inventing a worktree', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult(''))

    await expect(remoteCommandExistsAtWorkspaceRoot(TARGET, '/srv/plain-workspace', 'bat', { run: run })).resolves.toBe(
      true,
    )
    expect(run).toHaveBeenCalledWith(
      { type: 'commandExists', path: '/srv/plain-workspace', commandName: 'bat' },
      TARGET,
      { signal: undefined },
    )
  })

  test.each([
    ['canonical path', '/srv/repo-feature'],
    ['POSIX-normalized path', '/srv/repo-feature/'],
  ] as const)('checks a command only after resolving a known remote worktree from its %s', async (_label, path) => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'commandExists') return okRemoteResult('')
      return failRemoteResult('unexpected')
    })

    const result = await remoteCommandExists(TARGET, path, 'bat', {
      run: run,
      knownWorktrees,
    })

    expect(result).toBe(true)
    expect(run).toHaveBeenCalledWith({ type: 'commandExists', path: '/srv/repo-feature', commandName: 'bat' }, TARGET, {
      signal: undefined,
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitWorktreeList' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('returns false for unsafe command names without touching the remote', async () => {
    const run = vi.fn<RemoteGitRunner>()

    const result = await remoteCommandExists(TARGET, '/srv/repo-feature', 'bat; whoami', { run: run })

    expect(result).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  test('returns false for unknown worktrees', async () => {
    const run = vi.fn<RemoteGitRunner>()

    const result = await remoteCommandExists(TARGET, '/srv/missing', 'bat', {
      run: run,
      knownWorktrees: [{ path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false }],
    })

    expect(result).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
