import { describe, expect, test, vi } from 'vitest'
import {
  bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree,
  deleteRemoteBranch,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemoteSnapshot,
  getRemoteRepoWorktreePaths,
  getRemoteWorkspacePaneTargetIdentities,
  getRemoteStatusAndWorktrees,
  getRemoteTrackingBranches,
  getRemoteTreeWalk,
  getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch,
  fetchRemoteRepo,
  remoteCommandExists,
  remoteCommandExistsAtWorkspaceRoot,
  pushRemoteBranch,
  parseRemoteRepoExecutionIdentity,
  remoteExecResult,
  removeRemoteWorktree,
  type RemoteGitRunner,
  resolveRemoteWorktree,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { worktreeBootstrapConfigHash } from '#/system/git/worktree-bootstrap.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import {
  LINKED_TARGET,
  MAIN_AND_LINKED_WORKTREES_OUTPUT,
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  NUL,
  PRIMARY_WORKTREE_OUTPUT,
  SUCCESSFUL_REMOTE_REMOVAL_LIFECYCLE,
  TARGET,
  failRemoteResult,
  okRemoteResult,
  upstreamOutput,
  worktreePorcelain,
} from '#/system/ssh/git-test-utils.ts'

const worktreeListOutput =
  [
    'worktree /srv/repo',
    'HEAD f00ba40',
    'branch refs/heads/main',
    '',
    'worktree /srv/repo-feature',
    'HEAD ba5eba1',
    'branch refs/heads/feature/test',
  ].join(NUL) +
  NUL +
  NUL

describe('remote git filesystem', () => {
  test('publishes statuses only when before and after membership match', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(worktreeListOutput)
      if (command.type === 'gitStatus' && command.path === '/srv/repo') return okRemoteResult(`M  README.md${NUL}`)
      if (command.type === 'gitStatus' && command.path === '/srv/repo-feature') return okRemoteResult(`?? new.ts${NUL}`)
      return failRemoteResult('unexpected command')
    })

    const result = await getRemoteStatusAndWorktrees(TARGET, { run: run })

    expect(run.mock.calls.filter(([command]) => command.type === 'gitWorktreeList')).toHaveLength(2)
    expect(
      new Set(run.mock.calls.flatMap(([command]) => (command.type === 'gitStatus' ? [command.path] : []))),
    ).toEqual(new Set(['/srv/repo', '/srv/repo-feature']))
    expect(result.worktrees).toHaveLength(2)
    expect(result.worktrees[0]).toMatchObject({ path: '/srv/repo', branch: 'main', isPrimary: true, isBare: false })
    expect(result.worktrees[1]).toMatchObject({ path: '/srv/repo-feature', branch: 'feature/test', isPrimary: false })
    expect(result.statuses).toHaveLength(2)
    expect(result.statuses[0]).toMatchObject({
      path: '/srv/repo',
      branch: 'main',
      isMain: true,
    })
    expect(result.statuses[0]?.entries).toEqual([{ x: 'M', y: ' ', path: 'README.md' }])
    expect(result.statuses[1]?.entries).toEqual([{ x: '?', y: '?', path: 'new.ts' }])
  })

  test('treats bare worktrees as absent from statuses but keeps them in the worktree list', async () => {
    const worktreeListOutput =
      [
        'worktree /srv/repo',
        'bare',
        '',
        'worktree /srv/repo-feature',
        'HEAD ba5eba1',
        'branch refs/heads/feature/test',
      ].join(NUL) +
      NUL +
      NUL
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitWorktreeList' ? okRemoteResult(worktreeListOutput) : okRemoteResult(''),
    )

    const result = await getRemoteStatusAndWorktrees(TARGET, { run: run })

    // worktrees still includes the bare entry (callers may need it)
    expect(result.worktrees).toHaveLength(2)
    expect(result.worktrees[0]?.isBare).toBe(true)
    // statuses excludes the bare entry
    expect(result.statuses).toHaveLength(1)
    expect(result.statuses[0]?.path).toBe('/srv/repo-feature')
  })

  test('rejects when a status command fails', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitWorktreeList' ? okRemoteResult(worktreeListOutput) : failRemoteResult('boom'),
    )
    await expect(getRemoteStatusAndWorktrees(TARGET, { run: run })).rejects.toThrow('boom')
  })

  test('rejects when membership changes during status sampling', async () => {
    let listReads = 0
    const changed = ['worktree /srv/repo', 'HEAD f00ba40', 'detached'].join(NUL) + NUL + NUL
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(listReads++ === 0 ? worktreeListOutput : changed)
      return okRemoteResult('')
    })

    await expect(getRemoteStatusAndWorktrees(TARGET, { run: run })).rejects.toThrow('error.failed-read-repo')
  })

  test('skips gitWorktreeList when knownWorktrees is supplied', async () => {
    // Regression for the B4 round-trip optimisation: when the caller
    // already has a worktree list (because `getRemoteStatusAndWorktrees`
    // returned one in the same request), the walk path must NOT pay
    // a second `gitWorktreeList` SSH call.
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
            ['worktree /srv/repo-feature', 'HEAD aaaaaaa', 'branch refs/heads/feat'].join(NUL) + NUL + NUL,
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
