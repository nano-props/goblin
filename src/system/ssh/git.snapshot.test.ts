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
  getRemoteTrackingBranches,
  getRemoteTreeWalk,
  getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch,
  fetchRemoteRepo,
  remoteCommandExists,
  remoteCommandExistsAtWorkspaceRoot,
  pushRemoteBranch,
  parseRemoteRepoCommonDir,
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

describe('remote git snapshot', () => {
  test('parses a canonical repository common directory', () => {
    expect(parseRemoteRepoCommonDir('/srv/repo/.git\0')).toBe('/srv/repo/.git')
  })

  test('rejects malformed repository common directory output', () => {
    expect(parseRemoteRepoCommonDir('')).toBeNull()
  })

  test('builds browser URLs from remote verbose output', async () => {
    const run: RemoteGitRunner = async (command) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        default:
          return okRemoteResult('')
      }
    }

    await expect(getRemoteBrowserUrl(TARGET, { type: 'root' }, { run: run })).resolves.toBe(
      'https://github.com/acme/project',
    )
    await expect(getRemoteBrowserUrl(TARGET, { type: 'branch', branch: 'feature/test' }, { run: run })).resolves.toBe(
      'https://github.com/acme/project/tree/feature/test',
    )
    await expect(getRemoteBrowserUrl(TARGET, { type: 'commit', hash: 'abcdef1' }, { run: run })).resolves.toBe(
      'https://github.com/acme/project/commit/abcdef1',
    )
  })

  test('getRemoteBrowserUrl rejects unsafe URL targets before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult(''))

    await expect(
      getRemoteBrowserUrl(TARGET, { type: 'branch', branch: 'feature/test;echo bad' }, { run: run }),
    ).resolves.toBeNull()
    await expect(getRemoteBrowserUrl(TARGET, { type: 'commit', hash: 'not-a-hash' }, { run: run })).resolves.toBeNull()

    expect(run).not.toHaveBeenCalled()
  })

  test('includes remote metadata in remote snapshots', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'main\x00f00ba4000000000000000000000000000000000\x00f00ba40\x00Initial commit\x002024-01-01T00:00:00Z\x00Alice\x00origin/main\x00',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main'))
        case 'gitStatus':
          throw new Error('snapshot must not read status')
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@gitlab.com:acme/project.git (fetch)\norigin\tgit@gitlab.com:acme/project.git (push)',
          )
        default:
          return okRemoteResult('')
      }
    })

    const snapshot = await getRemoteSnapshot(TARGET, { run: run })

    expect(snapshot?.remote).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      hasGitHubRemote: false,
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitStatus' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('reads remote workspace-pane identity without status or remote display commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'gitLocalBranches') return okRemoteResult('main\nfeature/no-worktree')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run: run })).resolves.toEqual([
      { kind: 'git-worktree', worktreePath: '/srv/repo', head: { kind: 'branch', branchName: 'main' } },
      { kind: 'git-branch', branchName: 'feature/no-worktree' },
    ])
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledWith({ type: 'gitLocalBranches', path: '/srv/repo' }, TARGET, {
      signal: undefined,
    })
  })

  test('does not turn a failed authoritative remote snapshot into missing data', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'gitSnapshot') return failRemoteResult('ssh unavailable')
      return command.type === 'gitWorktreeList' ? okRemoteResult(PRIMARY_WORKTREE_OUTPUT) : okRemoteResult('')
    })

    await expect(getRemoteSnapshot(TARGET, { run })).rejects.toThrow('ssh unavailable')
  })

  test.each([
    '__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\nunexpected\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__',
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\nmain\x00abc1234',
  ])('rejects malformed authoritative snapshot envelopes', async (stdout) => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitSnapshot' ? okRemoteResult(stdout) : okRemoteResult(''),
    )

    await expect(getRemoteSnapshot(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('accepts an authoritative snapshot with three empty sections and no remotes', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitSnapshot'
        ? okRemoteResult(
            '__GOBLIN_REMOTE_CURRENT__\nvalue \n__GOBLIN_REMOTE_DEFAULT__\nvalue \n__GOBLIN_REMOTE_BRANCHES__\n',
          )
        : command.type === 'gitWorktreeList'
          ? okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
          : okRemoteResult(''),
    )

    await expect(getRemoteSnapshot(TARGET, { run })).resolves.toMatchObject({
      current: '',
      branches: [],
      remote: { hasRemotes: false, remotes: [] },
    })
  })

  test.each([
    'truncated remote output',
    'origin\tgit@example.test:project.git (fetch)',
    'origin\tgit@example.test:project.git (fetch)\ntruncated remote output',
  ])('rejects malformed authoritative remote output', async (remoteOutput) => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
      }
      return command.type === 'gitRemoteVerbose' ? okRemoteResult(remoteOutput) : okRemoteResult('')
    })

    await expect(getRemoteSnapshot(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test.each(['gitWorktreeList', 'gitRemoteVerbose'] as const)(
    'rejects an authoritative remote snapshot when %s fails',
    async (failedCommand) => {
      const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
        if (command.type === failedCommand) return failRemoteResult(`${failedCommand} failed`)
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        }
        return command.type === 'gitWorktreeList' ? okRemoteResult(PRIMARY_WORKTREE_OUTPUT) : okRemoteResult('')
      })

      await expect(getRemoteSnapshot(TARGET, { run })).rejects.toThrow(`${failedCommand} failed`)
    },
  )

  test('rejects failed authoritative worktree-path discovery', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => failRemoteResult('worktree discovery failed'))

    await expect(getRemoteRepoWorktreePaths(TARGET, { run })).rejects.toThrow('worktree discovery failed')
  })

  test('does not turn a failed remote worktree membership read into branch-only targets', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) =>
      command.type === 'gitWorktreeList'
        ? ({ ok: false, stdout: '', stderr: '', message: 'worktree list failed' } as RemoteCommandResult)
        : okRemoteResult(''),
    )

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run: run })).rejects.toThrow('worktree list failed')
  })

  test('returns detached worktree identity for an unborn repository', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitWorktreeList'
        ? okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\ndetached'))
        : okRemoteResult(''),
    )

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run: run })).resolves.toEqual([
      { kind: 'git-worktree', worktreePath: '/srv/repo', head: { kind: 'detached' } },
    ])
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('prefers stderr when converting remote exec failures', () => {
    expect(
      remoteExecResult({
        ok: false,
        stdout: '',
        stderr: 'permission denied',
        message: 'unknown',
      } as RemoteCommandResult),
    ).toEqual({ ok: false, message: 'unknown' })
  })
})
