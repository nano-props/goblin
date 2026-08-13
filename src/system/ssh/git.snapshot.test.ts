import { describe, expect, test, vi } from 'vitest'
import {
  getRemoteBrowserUrl,
  getRemoteSnapshot,
  getRemoteRepoWorktreePaths,
  getRemoteWorkspacePaneTargetIdentities,
  resolveRemoteWorktreePath,
  type RemoteGitRunner,
} from '#/system/ssh/git.ts'
import { parseRemoteRepoCommonDir, remoteExecResult } from '#/system/ssh/git-codec.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import {
  MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT,
  PRIMARY_WORKTREE_OUTPUT,
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
        case 'gitOperationState':
          return okRemoteResult('operation none\nmaterialized-branch\n')
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
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'resolveGitWorkspacePath':
          return okRemoteResult('/srv/repo\n')
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'value stale/read',
              '__GOBLIN_REMOTE_DEFAULT__',
              'value main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'main\x00f00ba40000000000000000000000000000000000\x00f00ba40\x00Initial commit\x002024-01-01T00:00:00Z\x00Alice\x00origin/main\x00',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain(
              'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/main',
            ),
          )
        case 'gitStatus':
          throw new Error('snapshot must not read status')
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@gitlab.com:acme/project.git (fetch)\norigin\tgit@gitlab.com:acme/project.git (push)',
          )
        case 'gitOperationState':
          return okRemoteResult('operation none\nmaterialized-branch main\n')
        default:
          return okRemoteResult('')
      }
    })

    const snapshot = await getRemoteSnapshot(TARGET, { run: run })

    expect(snapshot.current).toBe('main')
    expect(snapshot?.remote).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      hasGitHubRemote: false,
    })
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitOperationState',
        path: '/srv/repo',
        commonDir: '/srv/repo/.git',
        isPrimary: true,
        attachedBranch: 'main',
      },
      TARGET,
      { signal: undefined },
    )
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitStatus' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('includes detached operation state in remote worktree snapshots', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'resolveGitWorkspacePath':
          return okRemoteResult('/srv/repo\n')
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
          )
        case 'gitOperationState':
          return okRemoteResult('operation rebase\nmaterialized-branch refs/heads/feature/in-progress\n')
        default:
          return okRemoteResult('')
      }
    })

    const snapshot = await getRemoteSnapshot(TARGET, { run })

    expect(snapshot.worktrees).toEqual([
      expect.objectContaining({
        path: '/srv/repo',
        head: { kind: 'detached' },
        operation: { kind: 'rebase' },
        materializedBranch: 'feature/in-progress',
      }),
    ])
    expect(snapshot.current).toBe('')
  })

  test('resolves a physical source path only when its workspace spelling differs from membership', async () => {
    const aliasTarget = { ...TARGET, remotePath: '/srv/repo-alias' }
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'gitWorktreeList':
          return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        case 'resolveGitWorkspacePath':
          return okRemoteResult('/srv/repo\n')
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'gitOperationState':
          return okRemoteResult('operation none\nmaterialized-branch main\n')
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        default:
          return okRemoteResult('')
      }
    })

    await expect(getRemoteSnapshot(aliasTarget, { run })).resolves.toMatchObject({ current: 'main' })
    expect(run).toHaveBeenCalledWith({ type: 'resolveGitWorkspacePath', path: '/srv/repo-alias' }, aliasTarget, {
      signal: undefined,
    })
  })

  test.each(['', 'relative/repo', '/srv/repo\0hidden', '/srv/repo\n/other', '/srv/missing'])(
    'rejects a malformed or unknown resolved source workspace path %j',
    async (sourcePath) => {
      const aliasTarget = { ...TARGET, remotePath: '/srv/repo-alias' }
      const run = vi.fn<RemoteGitRunner>(async (command) => {
        if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
        if (command.type === 'resolveGitWorkspacePath') return okRemoteResult(sourcePath)
        return okRemoteResult('')
      })

      await expect(getRemoteSnapshot(aliasTarget, { run })).rejects.toThrow('error.failed-read-repo')
    },
  )

  test('preserves symbolic HEAD only for a bare remote source workspace', async () => {
    const bareTarget = { ...TARGET, remotePath: '/srv/repo.git' }
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitWorktreeList') return okRemoteResult(worktreePorcelain('worktree /srv/repo.git\nbare'))
      if (command.type === 'gitSnapshot') {
        return okRemoteResult(
          '__GOBLIN_REMOTE_CURRENT__\nvalue bare/main\n__GOBLIN_REMOTE_DEFAULT__\nvalue \n__GOBLIN_REMOTE_BRANCHES__\n',
        )
      }
      return okRemoteResult('')
    })

    await expect(getRemoteSnapshot(bareTarget, { run })).resolves.toMatchObject({
      current: 'bare/main',
      worktrees: [],
    })
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resolveGitWorkspacePath' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('reads linked worktree operation state with its own administrative identity', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      switch (command.type) {
        case 'resolveRepoCommonDir':
          return okRemoteResult('/srv/repo/.git\0')
        case 'resolveGitWorkspacePath':
          return okRemoteResult('/srv/repo\n')
        case 'gitSnapshot':
          return okRemoteResult(MAIN_EMPTY_BRANCHES_SNAPSHOT_OUTPUT)
        case 'gitWorktreeList':
          return okRemoteResult(
            worktreePorcelain(
              [
                'worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\nbranch refs/heads/main',
                'worktree /srv/portable\nHEAD f00ba41000000000000000000000000000000000\nbranch refs/heads/portable\nlocked portable',
              ].join('\n\n'),
            ),
          )
        case 'gitOperationState':
          return command.path === '/srv/portable'
            ? okRemoteResult('operation merge\nmaterialized-branch portable\n')
            : okRemoteResult('operation none\nmaterialized-branch main\n')
        default:
          return okRemoteResult('')
      }
    })

    const snapshot = await getRemoteSnapshot(TARGET, { run })

    expect(snapshot.worktrees).toContainEqual(
      expect.objectContaining({
        path: '/srv/portable',
        operation: { kind: 'merge' },
        materializedBranch: 'portable',
        isLocked: true,
      }),
    )
    expect(run).toHaveBeenCalledWith(
      {
        type: 'gitOperationState',
        path: '/srv/portable',
        commonDir: '/srv/repo/.git',
        isPrimary: false,
        attachedBranch: 'portable',
      },
      TARGET,
      { signal: undefined },
    )
  })

  test('reads remote workspace-pane identity without status or remote display commands', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'gitLocalBranches') return okRemoteResult('main\nfeature/no-worktree')
      if (command.type === 'gitOperationState') return okRemoteResult('operation none\nmaterialized-branch main\n')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run: run })).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/srv/repo',
        head: { kind: 'branch', branchName: 'main' },
        materializedBranch: 'main',
      },
      { kind: 'git-branch', branchName: 'feature/no-worktree' },
    ])
    expect(run).toHaveBeenCalledTimes(4)
    expect(run).toHaveBeenCalledWith({ type: 'gitLocalBranches', path: '/srv/repo' }, TARGET, {
      signal: undefined,
    })
  })

  test('rejects an attached remote membership that changes to rebase while operation state is read', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation rebase\nmaterialized-branch refs/heads/main\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('accepts an attached remote worktree while bisect is waiting for boundary commits', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'gitOperationState') return okRemoteResult('operation bisect\nmaterialized-branch main\n')
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/srv/repo',
        head: { kind: 'branch', branchName: 'main' },
        materializedBranch: 'main',
      },
    ])
  })

  test.each([
    ['rebase', 'operation rebase\nmaterialized-branch refs/heads/feature/in-progress\n'],
    ['bisect', 'operation bisect\nmaterialized-branch feature/in-progress\n'],
  ] as const)('does not expose the branch retained by a detached remote %s', async (kind, operationOutput) => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') return okRemoteResult(operationOutput)
      if (command.type === 'gitLocalBranches') return okRemoteResult('main\nfeature/in-progress')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/srv/repo',
        head: { kind: 'detached' },
        materializedBranch: 'feature/in-progress',
      },
      { kind: 'git-branch', branchName: 'main' },
    ])
  })

  test('rejects a detached-HEAD display value in the remote state protocol', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation rebase\nmaterialized-branch detached HEAD\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('rejects a plain branch name from the remote rebase protocol', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation rebase\nmaterialized-branch feature/in-progress\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main\nfeature/in-progress')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('rejects a ref-prefixed branch outside the remote rebase protocol', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation bisect\nmaterialized-branch refs/heads/main\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('rejects detached ownership without an operation at the remote producer boundary', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') return okRemoteResult('operation none\nmaterialized-branch main\n')
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('rejects duplicate materialized branches at the remote producer boundary', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain(
            [
              'worktree /srv/repo',
              'HEAD f00ba40000000000000000000000000000000000',
              'branch refs/heads/main',
              '',
              'worktree /srv/linked',
              'HEAD ba5eba1000000000000000000000000000000000',
              'branch refs/heads/main',
            ].join('\n'),
          ),
        )
      }
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation none\nmaterialized-branch main\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('rejects a committed materialized branch missing from remote refs', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation rebase\nmaterialized-branch refs/heads/feature/missing\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('rejects an empty branch ref from the remote rebase protocol', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation rebase\nmaterialized-branch refs/heads/\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('retains a remote bisect branch while presenting a concurrent cherry-pick', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitWorktreeList') {
        return okRemoteResult(
          worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
        )
      }
      if (command.type === 'gitOperationState') {
        return okRemoteResult('operation cherry-pick\nmaterialized-branch feature/in-progress\n')
      }
      if (command.type === 'gitLocalBranches') return okRemoteResult('main\nfeature/in-progress')
      throw new Error(`unexpected command: ${command.type}`)
    })

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/srv/repo',
        head: { kind: 'detached' },
        materializedBranch: 'feature/in-progress',
      },
      { kind: 'git-branch', branchName: 'main' },
    ])
  })

  test('does not turn a failed authoritative remote snapshot into missing data', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitSnapshot') return failRemoteResult('ssh unavailable')
      if (command.type === 'gitOperationState') return okRemoteResult('operation none\nmaterialized-branch main\n')
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
    const run = vi.fn<RemoteGitRunner>(async (command) => {
      if (command.type === 'gitSnapshot') return okRemoteResult(stdout)
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitOperationState') return okRemoteResult('operation none\nmaterialized-branch main\n')
      return okRemoteResult('')
    })

    await expect(getRemoteSnapshot(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
  })

  test('accepts an authoritative snapshot with three empty sections and no remotes', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitSnapshot'
        ? okRemoteResult(
            '__GOBLIN_REMOTE_CURRENT__\nvalue \n__GOBLIN_REMOTE_DEFAULT__\nvalue \n__GOBLIN_REMOTE_BRANCHES__\n',
          )
        : command.type === 'resolveRepoCommonDir'
          ? okRemoteResult('/srv/repo/.git\0')
          : command.type === 'resolveGitWorkspacePath'
            ? okRemoteResult('/srv/repo\n')
            : command.type === 'gitWorktreeList'
              ? okRemoteResult(
                  worktreePorcelain('worktree /srv/repo\nHEAD f00ba40000000000000000000000000000000000\ndetached'),
                )
              : command.type === 'gitOperationState'
                ? okRemoteResult('operation none\nmaterialized-branch\n')
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
      if (command.type === 'gitRemoteVerbose') return okRemoteResult(remoteOutput)
      if (command.type === 'gitWorktreeList') return okRemoteResult(PRIMARY_WORKTREE_OUTPUT)
      if (command.type === 'resolveRepoCommonDir') return okRemoteResult('/srv/repo/.git\0')
      if (command.type === 'gitOperationState') return okRemoteResult('operation none\nmaterialized-branch main\n')
      return okRemoteResult('')
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

  test('resolves a created worktree through the remote Git root boundary', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'revParseTopLevel' ? okRemoteResult('/srv/feature\n') : failRemoteResult('unexpected'),
    )

    await expect(resolveRemoteWorktreePath(TARGET, '/srv/nested/../feature', { run })).resolves.toBe('/srv/feature')
    expect(run).toHaveBeenCalledWith({ type: 'revParseTopLevel', path: '/srv/nested/../feature' }, TARGET, {
      signal: undefined,
    })
  })

  test('does not turn a failed remote worktree membership read into branch-only targets', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) =>
      command.type === 'gitWorktreeList'
        ? ({ ok: false, stdout: '', stderr: '', message: 'worktree list failed' } as RemoteCommandResult)
        : okRemoteResult(''),
    )

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run: run })).rejects.toThrow('worktree list failed')
  })

  test('returns an attached worktree identity without a commit for an unborn repository', async () => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitWorktreeList'
        ? okRemoteResult(worktreePorcelain(`worktree /srv/repo\nHEAD ${'0'.repeat(40)}\nbranch refs/heads/main`))
        : command.type === 'resolveRepoCommonDir'
          ? okRemoteResult('/srv/repo/.git\0')
          : command.type === 'gitOperationState'
            ? okRemoteResult('operation none\nmaterialized-branch main\n')
            : okRemoteResult(''),
    )

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run: run })).resolves.toEqual([
      {
        kind: 'git-worktree',
        worktreePath: '/srv/repo',
        head: { kind: 'branch', branchName: 'main' },
        materializedBranch: 'main',
      },
    ])
    expect(run).toHaveBeenCalledTimes(4)
  })

  test.each([
    ['detached', 'operation none\nmaterialized-branch\n'],
    ['branch refs/heads/main', 'operation merge\nmaterialized-branch main\n'],
  ])('rejects an invalid unborn remote worktree with %s state', async (membershipState, operationState) => {
    const run = vi.fn<RemoteGitRunner>(async (command) =>
      command.type === 'gitWorktreeList'
        ? okRemoteResult(worktreePorcelain(`worktree /srv/repo\nHEAD ${'0'.repeat(40)}\n${membershipState}`))
        : command.type === 'resolveRepoCommonDir'
          ? okRemoteResult('/srv/repo/.git\0')
          : command.type === 'gitOperationState'
            ? okRemoteResult(operationState)
            : okRemoteResult(''),
    )

    await expect(getRemoteWorkspacePaneTargetIdentities(TARGET, { run })).rejects.toThrow('error.failed-read-repo')
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
