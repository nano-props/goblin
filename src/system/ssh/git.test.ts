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

const TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo',
})!
const LINKED_TARGET = normalizeRemoteTarget({
  alias: 'prod',
  host: 'example.com',
  user: 'alice',
  port: 22,
  remotePath: '/srv/repo-feature',
})!

const NUL = String.fromCharCode(0)

function worktreePorcelain(lines: string): string {
  return `${lines
    .trim()
    .split('\n')
    .map((line) => line.replace(/^HEAD ([0-9a-f]{7})$/u, 'HEAD $100000000000000000000000000000000'))
    .join(NUL)}${NUL}${NUL}`
}

function upstreamOutput(remote: string, branch: string, trackState = '='): string {
  const ref = remote === '.' ? `refs/heads/${branch}` : `refs/remotes/${remote}/${branch}`
  return [ref, remote, `refs/heads/${branch}`, trackState].join(NUL)
}

const PRIMARY_WORKTREE_OUTPUT = worktreePorcelain(
  'worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main',
)

describe('remote git helpers', () => {
  test('parses a canonical repository execution identity with its object generation', () => {
    expect(
      parseRemoteRepoExecutionIdentity(
        [
          '0123456789abcdef0123456789abcdef',
          'machine-a',
          'mnt-a',
          '/srv/repo/.git',
          '10',
          '20',
          '/srv/repo/.git/objects',
          '30',
          '40',
          '',
        ].join('\0'),
      ),
    ).toEqual({
      commonDir: '/srv/repo/.git',
      generationKey: JSON.stringify({
        runtimeToken: '0123456789abcdef0123456789abcdef',
        machineFact: 'machine-a',
        rootNamespaceFact: 'mnt-a',
        commonDirDeviceId: '10',
        commonDirInode: '20',
        objectsDir: '/srv/repo/.git/objects',
        objectsDirDeviceId: '30',
        objectsDirInode: '40',
      }),
    })
  })

  test('rejects malformed repository execution identity output', () => {
    expect(parseRemoteRepoExecutionIdentity('invalid')).toBeNull()
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
    const run: RemoteGitRunner = async (command) => {
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
          return okRemoteResult('')
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@gitlab.com:acme/project.git (fetch)\norigin\tgit@gitlab.com:acme/project.git (push)',
          )
        default:
          return okRemoteResult('')
      }
    }

    const snapshot = await getRemoteSnapshot(TARGET, { run: run })

    expect(snapshot?.remote).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      hasGitHubRemote: false,
    })
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
    expect(run).toHaveBeenCalledTimes(3)
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
        ? okRemoteResult('__GOBLIN_REMOTE_CURRENT__\nvalue \n__GOBLIN_REMOTE_DEFAULT__\nvalue \n__GOBLIN_REMOTE_BRANCHES__\n')
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
  ])(
    'rejects malformed authoritative remote output',
    async (remoteOutput) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === 'gitSnapshot') {
          return okRemoteResult('__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n')
        }
        return command.type === 'gitRemoteVerbose' ? okRemoteResult(remoteOutput) : okRemoteResult('')
      })

      await expect(getRemoteSnapshot(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
    },
  )

  test.each(['gitWorktreeList', 'gitRemoteVerbose'] as const)(
    'rejects an authoritative remote snapshot when %s fails',
    async (failedCommand) => {
      const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
        if (command.type === failedCommand) return failRemoteResult(`${failedCommand} failed`)
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(
            '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
          )
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
    expect(run).toHaveBeenCalledTimes(3)
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

    expect(result).toEqual({ ok: true, message: 'Deleted branch feature/test' })
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

    expect(result).toEqual({ ok: false, message: 'error.branch-not-fully-merged' })
    expect(run.mock.calls.filter(([command]) => command.type === 'gitIsAncestor')).toHaveLength(1)
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitBranchDelete' }),
      TARGET,
      expect.anything(),
    )
  })

  test('deleteRemoteBranch deletes the configured upstream when requested', async () => {
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
              'feature/test\x00ba5eba1000000000000000000000000000000000\x00ba5eba1\x00Feature\x002024-01-02T00:00:00Z\x00Alice\x00fork/topic/feature-test\x00',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/release/1.0'))
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return okRemoteResult('true')
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'topic/feature-test'))
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        case 'gitPushDeleteBranch':
          return okRemoteResult('deleted upstream')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, {
      branch: 'feature/test',
      deleteUpstream: true,
      run: run,
    })

    expect(result).toEqual({ ok: true, message: 'deleted upstream' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitPushDeleteBranch', path: '/srv/repo', remote: 'fork', branch: 'topic/feature-test' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run.mock.calls.filter(([command]) => command.type === 'gitUpstream')).toHaveLength(1)
  })

  test('deleteRemoteBranch reports upstream delete failure after deleting the local branch', async () => {
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
              'feature/test\x00ba5eba1000000000000000000000000000000000\x00ba5eba1\x00Feature\x002024-01-02T00:00:00Z\x00Alice\x00origin/feature/test\x00',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/release/1.0'))
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return okRemoteResult('true')
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('origin', 'feature/test'))
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        case 'gitPushDeleteBranch':
          return failRemoteResult('remote rejected delete')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, {
      branch: 'feature/test',
      deleteUpstream: true,
      run: run,
    })

    expect(result).toEqual({ ok: false, message: 'remote rejected delete', repositoryStateChanged: true })
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
              ].join(NUL) + NUL + NUL,
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
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
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
          return okRemoteResult(
            worktreePorcelain(
              'worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main\n\nworktree /srv/repo-feature\nHEAD ba5eba1\nbranch refs/heads/feature/test',
            ),
          )
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitSnapshot':
          return okRemoteResult(
            '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
          )
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
      afterRemoveFailed: async () => {},
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
          return okRemoteResult(
            [
              'worktree /srv/repo',
              'HEAD f00ba40',
              'branch refs/heads/main',
              '',
              'worktree /srv/repo-feature',
              'HEAD ba5eba1',
              'branch refs/heads/feature/test',
            ].join(NUL) + NUL + NUL,
          )
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitWorktreeRemove':
          return okRemoteResult('Removed worktree')
        default:
          return okRemoteResult('')
      }
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/./repo-feature/',
      deleteBranch: false,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Removed worktree',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      TARGET,
      { timeoutMs: 180_000 },
    )
  })

  test('removeRemoteWorktree rejects relative worktree paths before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
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
        return okRemoteResult(worktreePorcelain(
          'worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main\n\nworktree /srv/repo-feature\nHEAD ba5eba1\nbranch refs/heads/feature/test',
        ))
      }
      if (command.type === 'gitStatus') return failRemoteResult('status unavailable')
      return failRemoteResult('unexpected mutation')
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: false,
      run,
    })

    expect(result).toEqual({ ok: false, message: 'status unavailable' })
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })

  test('removeRemoteWorktree rejects an equivalent path to the primary worktree', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main'))
      }
      return okRemoteResult('')
    })

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
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
            return okRemoteResult(
              [
                'worktree /srv/repo',
                'HEAD f00ba40',
                'branch refs/heads/main',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join(NUL) + NUL + NUL,
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'value main',
                '__GOBLIN_REMOTE_DEFAULT__',
                'value main',
                '__GOBLIN_REMOTE_BRANCHES__',
                '',
              ].join('\n'),
            )
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
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      deleteUpstream: true,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'deleted upstream',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitPushDeleteBranch', path: '/srv/repo', remote: 'fork', branch: 'topic/feature-test' },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
    expect(run.mock.calls.filter(([command]) => command.type === 'gitUpstream')).toHaveLength(1)
  })

  test('removeRemoteWorktree resolves the upstream before any mutation', async () => {
    const beforeRemove = vi.fn(async () => ({ ok: true, message: '' }))
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba400\nbranch refs/heads/main\n\nworktree /srv/repo-feature\nHEAD ba5eba1\nbranch refs/heads/feature/test'),
        )
      }
      if (command.type === 'gitStatus') return okRemoteResult('')
      if (command.type === 'gitUpstream') return failRemoteResult('upstream read failed')
      return okRemoteResult('')
    })

    await expect(
      removeRemoteWorktree(TARGET, {
        beforeRemove,
        afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
        afterRemoveFailed: async () => {},
        branch: 'feature/test',
        worktreePath: '/srv/repo-feature',
        deleteBranch: true,
        deleteUpstream: true,
        run,
      }),
    ).rejects.toThrow('upstream read failed')
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitWorktreeRemove' }), TARGET, expect.anything())
  })

  test('removeRemoteWorktree rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
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
            return okRemoteResult(
              [
                'worktree /srv/repo',
                'HEAD f00ba40',
                'branch refs/heads/main',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join(NUL) + NUL + NUL,
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return command.path === '/srv/repo'
              ? okRemoteResult(
                  [
                    '__GOBLIN_REMOTE_CURRENT__',
                    'value main',
                    '__GOBLIN_REMOTE_DEFAULT__',
                    'value main',
                    '__GOBLIN_REMOTE_BRANCHES__',
                    '',
                  ].join('\n'),
                )
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
      beforeRemove: async () => ({ ok: true, message: '' }),
      afterWorktreeRemoved: async () => ({ ok: true, message: '' }),
      afterRemoveFailed: async () => {},
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      deleteBranch: true,
      run: run,
    })

    expect(result).toEqual({
      ok: true,
      message: 'Deleted branch feature/test',
      affectedWorktreePaths: ['/srv/repo', '/srv/repo-feature'],
    })
    expect(run).toHaveBeenCalledWith({ type: 'gitSnapshot', path: '/srv/repo' }, LINKED_TARGET, { signal: undefined })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitWorktreeRemove', path: '/srv/repo', worktreePath: '/srv/repo-feature' },
      LINKED_TARGET,
      { signal: undefined, timeoutMs: 180_000 },
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

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(run).not.toHaveBeenCalled()
  })

  test('pullRemoteBranch reports missing upstream remote explicitly', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'feature/test'))
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitWorktreeList':
          return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        case 'gitStatus':
          return okRemoteResult('')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pullRemoteBranch(TARGET, 'feature/test', undefined, { run: run })

    expect(result).toEqual({ ok: false, message: 'error.pull-no-remote' })
  })

  test('pushRemoteBranch prefers the configured upstream remote and branch', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git (fetch)',
              'origin\tgit@github.com:acme/project.git (push)',
              'fork\tgit@github.com:alice/project.git (fetch)',
              'fork\tgit@github.com:alice/project.git (push)',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'topic/feature-test'))
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run })

    expect(result).toEqual({ ok: true, message: 'pushed' })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitPush',
        path: '/srv/repo',
        remote: 'fork',
        branch: 'feature/test',
        targetBranch: 'topic/feature-test',
        setUpstream: false,
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test('pushRemoteBranch falls back to origin and sets upstream when no upstream is configured', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitUpstream':
          return okRemoteResult(NUL.repeat(3))
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run })

    expect(result).toEqual({ ok: true, message: 'pushed' })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitPush',
        path: '/srv/repo',
        remote: 'origin',
        branch: 'feature/test',
        targetBranch: 'feature/test',
        setUpstream: true,
      },
      TARGET,
      { signal: undefined, timeoutMs: 180_000 },
    )
  })

  test.each(['pullRemoteBranch', 'pushRemoteBranch'] as const)(
    '%s rejects remote discovery failure before mutation',
    async (operationName) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(
            '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
          )
        }
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

  test('fetchRemoteRepo prefers the current branch upstream remote over fetch --all', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string; remote?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value feature/test',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitRemoteVerbose':
          return okRemoteResult(
            [
              'origin\tgit@github.com:acme/project.git (fetch)',
              'origin\tgit@github.com:acme/project.git (push)',
              'fork\tgit@github.com:alice/project.git (fetch)',
              'fork\tgit@github.com:alice/project.git (push)',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult(upstreamOutput('fork', 'feature/test'))
        case 'gitFetchRemote':
          return okRemoteResult(`fetched ${command.remote}`)
        default:
          return okRemoteResult('')
      }
    })

    const result = await fetchRemoteRepo(TARGET, { run: run })

    expect(result).toEqual({ ok: true, message: 'fetched fork' })
    expect(run).toHaveBeenCalledWith({ type: 'gitFetchRemote', path: '/srv/repo', remote: 'fork' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).not.toHaveBeenCalledWith({ type: 'gitFetchAll', path: '/srv/repo' }, TARGET, expect.anything())
  })

  test.each(['gitSnapshot', 'gitRemoteVerbose', 'gitUpstream'] as const)(
    'fetchRemoteRepo rejects when authoritative %s discovery fails',
    async (failedCommand) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === failedCommand) return failRemoteResult(`${failedCommand} failed`)
        if (command.type === 'gitSnapshot') {
          return okRemoteResult(
            '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
          )
        }
        if (command.type === 'gitRemoteVerbose') {
          return okRemoteResult(
            'origin\tgit@example.test:project.git (fetch)\norigin\tgit@example.test:project.git (push)',
          )
        }
        return okRemoteResult('')
      })

      await expect(fetchRemoteRepo(TARGET, { run })).rejects.toThrow(`${failedCommand} failed`)
      expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitFetchRemote' }), TARGET, expect.anything())
    },
  )

  test.each([
    '__GOBLIN_REMOTE_CURRENT__\nvalue main\nunexpected\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
    '__GOBLIN_REMOTE_CURRENT__\nvalue invalid branch\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
  ])('fetchRemoteRepo rejects malformed current-branch authority', async (snapshotOutput) => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitSnapshot' ? okRemoteResult(snapshotOutput) : okRemoteResult(''),
    )

    await expect(fetchRemoteRepo(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test.each(['origin/main\nunexpected/branch', 'invalid remote/main', 'origin/invalid branch'])(
    'pushRemoteBranch rejects malformed upstream authority',
    async (upstreamOutput) => {
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === 'gitRemoteVerbose') {
          return okRemoteResult(
            'origin\tgit@example.test:project.git (fetch)\norigin\tgit@example.test:project.git (push)',
          )
        }
        return command.type === 'gitUpstream' ? okRemoteResult(upstreamOutput) : okRemoteResult('')
      })

      await expect(pushRemoteBranch(TARGET, 'feature/test', { run })).rejects.toThrow('error.failed-read-repo')
      expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitPush' }), TARGET, expect.anything())
    },
  )

  test('deleteRemoteBranch rejects merge-fact failure before deleting', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(
          '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
        )
      }
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(worktreePorcelain('worktree /srv/repo\nHEAD f00ba40\nbranch refs/heads/main'))
      }
      if (command.type === 'gitUpstream') return okRemoteResult(NUL.repeat(3))
      if (command.type === 'gitIsAncestor') return failRemoteResult('merge read failed')
      return okRemoteResult('')
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/test', run })).rejects.toThrow('merge read failed')
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitBranchDelete' }), TARGET, expect.anything())
  })

  test('deleteRemoteBranch rejects malformed merge-fact output before deleting', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(
          '__GOBLIN_REMOTE_CURRENT__\nvalue main\n__GOBLIN_REMOTE_DEFAULT__\nvalue main\n__GOBLIN_REMOTE_BRANCHES__\n',
        )
      }
      if (command.type === 'gitIsAncestor') return okRemoteResult('unknown')
      return okRemoteResult('')
    })

    await expect(deleteRemoteBranch(TARGET, { branch: 'feature/test', run })).rejects.toThrow(
      'error.failed-read-repo',
    )
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gitBranchDelete' }), TARGET, expect.anything())
  })

  test('getRemoteTrackingBranches filters */HEAD from valid refs', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\thttps://example.test/repo.git (fetch)\norigin\thttps://example.test/repo.git (push)',
          )
        case 'gitRemoteFetchSpecs':
          return okRemoteResult('+refs/heads/*:refs/remotes/origin/*')
        case 'gitRemoteBranches':
          return okRemoteResult(
            [
              'refs/remotes/origin/HEAD',
              'refs/remotes/origin/main',
              'refs/remotes/origin/feature/auth',
              'refs/remotes/origin/feature/ui',
            ].join('\n'),
          )
        default:
          throw new Error(`unexpected command: ${command.type}`)
      }
    })
    const refs = await getRemoteTrackingBranches(TARGET, { run })
    expect(run).toHaveBeenCalledWith({ type: 'gitRemoteBranches', path: '/srv/repo' }, TARGET, { signal: undefined })
    expect(refs).toEqual([
      { ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' },
      { ref: 'refs/remotes/origin/feature/auth', remote: 'origin', branch: 'feature/auth' },
      { ref: 'refs/remotes/origin/feature/ui', remote: 'origin', branch: 'feature/ui' },
    ])
  })

  test('getRemoteTrackingBranches rejects malformed authoritative output', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitRemoteVerbose'
        ? okRemoteResult('origin\thttps://example.test/repo.git (fetch)\norigin\thttps://example.test/repo.git (push)')
        : okRemoteResult('refs/remotes/origin/main\ntruncated-ref'),
    )
    await expect(getRemoteTrackingBranches(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('getRemoteTrackingBranches rejects when the remote command fails', async () => {
    const run = vi.fn<RemoteGitRunner>(async () => ({ ok: false, stdout: '', stderr: 'ssh: connection refused' }))
    await expect(getRemoteTrackingBranches(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('getRemoteWorktreeBootstrapPreview reads config without running bootstrap', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') {
        return okRemoteResult(
          '[worktree]\ncopy = [".env", "config/*"]\nsymlink = ["linked.txt"]\nexclude = ["config/*.log"]\nsetup = "bun install"',
        )
      }
      return okRemoteResult('')
    })

    const result = await getRemoteWorktreeBootstrapPreview(TARGET, { run: run })

    expect(result).toEqual({
      ok: true,
      preview: {
        hasConfig: true,
        hasOperations: true,
        configHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        copyCount: 2,
        symlinkCount: 1,
        hardlinkCount: 0,
        excludeCount: 1,
        setup: { command: 'bun install' },
      },
    })
    expect(run).toHaveBeenCalledWith({ type: 'revParseTopLevel', path: '/srv/repo' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith({ type: 'readRemoteFile', path: '/srv/repo/goblin.toml' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate does nothing when goblin.toml is absent', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run })

    expect(result).toEqual({ ok: true, message: '' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('bootstrapRemoteWorktreeAfterCreate runs remote bootstrap and formats output', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') {
        return okRemoteResult('[worktree]\ncopy = [".env"]\nsetup = "bun install"')
      }
      if (command.type === 'bootstrapRemoteWorktree') {
        return okRemoteResult('GOBLIN_BOOTSTRAP_COPY .env\nGOBLIN_BOOTSTRAP_SETUP bun install')
      }
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run })

    expect(result).toEqual({
      ok: true,
      message: 'Copied 1 path: .env\nRan setup: bun install',
      worktreeBootstrap: {
        copy: { count: 1, paths: ['.env'] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 0, paths: [] },
        setup: { command: 'bun install' },
      },
    })
    expect(run).toHaveBeenCalledWith({ type: 'revParseTopLevel', path: '/srv/repo' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith({ type: 'readRemoteFile', path: '/srv/repo/goblin.toml' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'bootstrapRemoteWorktree',
        sourceRoot: '/srv/repo',
        targetRoot: '/srv/repo-worktree',
        copy: ['.env'],
        symlink: [],
        hardlink: [],
        exclude: [],
        setup: 'bun install',
      },
      TARGET,
      { signal: undefined, timeoutMs: 600_000 },
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate does not run when goblin.toml changed after confirmation', async () => {
    const trustedHash = worktreeBootstrapConfigHash('[worktree]\ncopy = [".env"]')
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = ["other.env"]')
      if (command.type === 'bootstrapRemoteWorktree') return okRemoteResult('GOBLIN_BOOTSTRAP_COPY other.env')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', {
      run: run,
      expectedConfigHash: trustedHash,
    })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: goblin.toml changed after confirmation',
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate reads config from the remote repo root', async () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo/packages/app',
    })!
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'revParseTopLevel') return okRemoteResult('/srv/repo')
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = [".env"]')
      if (command.type === 'bootstrapRemoteWorktree') return okRemoteResult('GOBLIN_BOOTSTRAP_COPY .env')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(target, '/srv/repo-worktree', { run: run })

    expect(result.ok).toBe(true)
    expect(run).toHaveBeenCalledWith({ type: 'readRemoteFile', path: '/srv/repo/goblin.toml' }, target, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree', sourceRoot: '/srv/repo' }),
      target,
      { signal: undefined, timeoutMs: 600_000 },
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate returns error when config is invalid', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = "not-an-array"')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Worktree bootstrap failed')
  })

  test('bootstrapRemoteWorktreeAfterCreate rejects unsafe paths before running remote bootstrap', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = ["../secret.env"]')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('bootstrap path escapes repo root')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate returns error when remote bootstrap fails', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\nsetup = "bun install"')
      if (command.type === 'bootstrapRemoteWorktree') return failRemoteResult('bun: command not found')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('bun: command not found')
  })

  test('getRemoteLog rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>()

    const entries = await getRemoteLog(TARGET, '../feature', undefined, undefined, { run: run })

    expect(entries).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  test('deleteRemoteBranch rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn<RemoteGitRunner>()

    const result = await deleteRemoteBranch(TARGET, { branch: '../feature', run: run })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('getRemoteStatusAndWorktrees', () => {
  const NUL = String.fromCharCode(0)
  const worktreeListOutput = [
    'worktree /srv/repo',
    'HEAD f00ba40',
    'branch refs/heads/main',
    '',
    'worktree /srv/repo-feature',
    'HEAD ba5eba1',
    'branch refs/heads/feature/test',
  ].join(NUL) + NUL + NUL

  test('publishes statuses only when before and after membership match', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(worktreeListOutput)
      if (command.type === 'gitStatus' && command.path === '/srv/repo') return okRemoteResult(`M  README.md${NUL}`)
      if (command.type === 'gitStatus' && command.path === '/srv/repo-feature') return okRemoteResult(`?? new.ts${NUL}`)
      return failRemoteResult('unexpected command')
    })

    const result = await getRemoteStatusAndWorktrees(TARGET, { run: run })

    expect(run.mock.calls.filter(([command]) => command.type === 'gitWorktreeList')).toHaveLength(2)
    expect(new Set(run.mock.calls.flatMap(([command]) => command.type === 'gitStatus' ? [command.path] : []))).toEqual(
      new Set(['/srv/repo', '/srv/repo-feature']),
    )
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
    const worktreeListOutput = [
      'worktree /srv/repo',
      'bare',
      '',
      'worktree /srv/repo-feature',
      'HEAD ba5eba1',
      'branch refs/heads/feature/test',
    ].join(NUL) + NUL + NUL
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
})

describe('getRemoteTreeWalk knownWorktrees path', () => {
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
})

describe('resolveRemoteWorktree', () => {
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
})

describe('remoteCommandExists', () => {
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

  test('validates the remote worktree before checking the command', async () => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'commandExists') return okRemoteResult('')
      return failRemoteResult('unexpected')
    })

    const result = await remoteCommandExists(TARGET, '/srv/repo-feature', 'bat', {
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

  test('matches known remote worktrees after POSIX path normalization', async () => {
    const knownWorktrees: WorktreeInfo[] = [
      { path: '/srv/repo-feature', branch: 'feature/test', isBare: false, isPrimary: false },
    ]
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'commandExists') return okRemoteResult('')
      return failRemoteResult('unexpected')
    })

    const result = await remoteCommandExists(TARGET, '/srv/repo-feature/', 'bat', {
      run: run,
      knownWorktrees,
    })

    expect(result).toBe(true)
    expect(run).toHaveBeenCalledWith({ type: 'commandExists', path: '/srv/repo-feature', commandName: 'bat' }, TARGET, {
      signal: undefined,
    })
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

function okRemoteResult(stdout: string): RemoteCommandResult {
  return { ok: true, stdout, stderr: '' }
}

function failRemoteResult(message: string): RemoteCommandResult {
  return { ok: false, stdout: '', stderr: message, message }
}
