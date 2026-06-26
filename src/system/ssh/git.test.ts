import { describe, expect, test, vi } from 'vitest'
import {
  bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree,
  deleteRemoteBranch,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemoteSnapshot,
  getRemoteTrackingBranches,
  getRemoteWorktreeBootstrapPreview,
  pullRemoteBranch,
  fetchRemoteRepository,
  pushRemoteBranch,
  remoteExecResult,
  removeRemoteWorktree,
} from '#/system/ssh/git.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { worktreeBootstrapConfigHash } from '#/system/git/worktree-bootstrap.ts'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

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

describe('remote git helpers', () => {
  test('builds browser URLs from remote verbose output', async () => {
    const run = async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitUpstream':
          return okRemoteResult('origin/feature/test')
        default:
          return okRemoteResult('')
      }
    }

    await expect(getRemoteBrowserUrl(TARGET, undefined, { run: run as any })).resolves.toBe(
      'https://github.com/acme/project',
    )
    await expect(getRemoteBrowserUrl(TARGET, 'feature/test', { run: run as any })).resolves.toBe(
      'https://github.com/acme/project/tree/feature/test',
    )
  })

  test('getRemoteBrowserUrl rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn(async () => okRemoteResult(''))

    await expect(getRemoteBrowserUrl(TARGET, 'feature/test;echo bad', { run: run as any })).resolves.toBeNull()

    expect(run).not.toHaveBeenCalled()
  })

  test('includes remote metadata in remote snapshots', async () => {
    const run = async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'main\x1ff00ba4\x1fInitial commit\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/main\x1f',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/main\n')
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

    const snapshot = await getRemoteSnapshot(TARGET, { run: run as any })

    expect(snapshot?.remote).toMatchObject({
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'gitlab',
      hasGitHubRemote: false,
    })
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
    const run = vi.fn(async (command: { type: string; ancestor?: string; descendant?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'release/1.0',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              'release/1.0\x1ff00ba4\x1fRelease\x1f2024-01-01T00:00:00Z\x1fAlice\x1forigin/release/1.0\x1f',
              'feature/test\x1fba5eba1\x1fFeature\x1f2024-01-02T00:00:00Z\x1fAlice\x1f\x1f',
            ].join('\n'),
          )
        case 'gitWorktreeList':
          return okRemoteResult('worktree /srv/repo\nHEAD f00ba4\nbranch refs/heads/release/1.0\n')
        case 'gitStatus':
          return okRemoteResult('')
        case 'gitRemoteVerbose':
          return okRemoteResult('')
        case 'gitIsAncestor':
          return command.descendant === 'release/1.0' ? okRemoteResult('') : failRemoteResult('not merged')
        case 'gitUpstream':
          return failRemoteResult('no upstream')
        case 'gitBranchDelete':
          return okRemoteResult('Deleted branch feature/test')
        default:
          return okRemoteResult('')
      }
    })

    const result = await deleteRemoteBranch(TARGET, { branch: 'feature/test', run: run as any })

    expect(result).toEqual({ ok: true, message: 'Deleted branch feature/test' })
    expect(run).toHaveBeenCalledWith(
      { type: 'gitIsAncestor', path: '/srv/repo', ancestor: 'feature/test', descendant: 'release/1.0' },
      TARGET,
      { signal: undefined },
    )
  })

  test('removeRemoteWorktree allows deleting branch when merged into current HEAD without upstream', async () => {
    const run = vi.fn(
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
                'HEAD f00ba4',
                'branch refs/heads/release/1.0',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join('\n'),
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return okRemoteResult(
              [
                '__GOBLIN_REMOTE_CURRENT__',
                'release/1.0',
                '__GOBLIN_REMOTE_DEFAULT__',
                'main',
                '__GOBLIN_REMOTE_BRANCHES__',
                '',
              ].join('\n'),
            )
          case 'gitIsAncestor':
            return command.descendant === 'release/1.0' ? okRemoteResult('') : failRemoteResult('not merged')
          case 'gitUpstream':
            return failRemoteResult('no upstream')
          case 'gitWorktreeRemove':
            return okRemoteResult('Removed worktree')
          case 'gitBranchDelete':
            return okRemoteResult('Deleted branch feature/test')
          default:
            return okRemoteResult('')
        }
      },
    )

    const result = await removeRemoteWorktree(TARGET, {
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      alsoDeleteBranch: true,
      run: run as any,
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

  test('removeRemoteWorktree rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn(async () => okRemoteResult(''))

    const result = await removeRemoteWorktree(TARGET, {
      branch: 'feature/test;echo bad',
      worktreePath: '/srv/repo-feature',
      alsoDeleteBranch: true,
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })

  test('removeRemoteWorktree removes the currently opened linked worktree from the primary path', async () => {
    const run = vi.fn(
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
                'HEAD f00ba4',
                'branch refs/heads/main',
                '',
                'worktree /srv/repo-feature',
                'HEAD ba5eba1',
                'branch refs/heads/feature/test',
              ].join('\n'),
            )
          case 'gitStatus':
            return okRemoteResult('')
          case 'gitSnapshot':
            return command.path === '/srv/repo'
              ? okRemoteResult(
                  [
                    '__GOBLIN_REMOTE_CURRENT__',
                    'main',
                    '__GOBLIN_REMOTE_DEFAULT__',
                    'main',
                    '__GOBLIN_REMOTE_BRANCHES__',
                    '',
                  ].join('\n'),
                )
              : failRemoteResult('removed cwd should not be used')
          case 'gitIsAncestor':
            return command.path === '/srv/repo' && command.descendant === 'main'
              ? okRemoteResult('')
              : failRemoteResult('not merged')
          case 'gitUpstream':
            return failRemoteResult('no upstream')
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
      branch: 'feature/test',
      worktreePath: '/srv/repo-feature',
      alsoDeleteBranch: true,
      run: run as any,
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
    const run = vi.fn()

    const result = await createRemoteWorktree(TARGET, {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/test', baseRef: 'main' },
      run: run as any,
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(run).not.toHaveBeenCalled()
  })

  test('pullRemoteBranch reports missing upstream remote explicitly', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'main',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
              '__GOBLIN_REMOTE_BRANCHES__',
              '',
            ].join('\n'),
          )
        case 'gitUpstream':
          return okRemoteResult('fork/feature/test')
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        default:
          return okRemoteResult('')
      }
    })

    const result = await pullRemoteBranch(TARGET, 'feature/test', undefined, { run: run as any })

    expect(result).toEqual({ ok: false, message: 'error.pull-no-remote' })
  })

  test('pushRemoteBranch prefers the configured upstream remote and branch', async () => {
    const run = vi.fn(async (command: { type: string }) => {
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
          return okRemoteResult('fork/topic/feature-test')
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run as any })

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
    const run = vi.fn(async (command: { type: string }) => {
      switch (command.type) {
        case 'gitRemoteVerbose':
          return okRemoteResult(
            'origin\tgit@github.com:acme/project.git (fetch)\norigin\tgit@github.com:acme/project.git (push)',
          )
        case 'gitUpstream':
          return failRemoteResult('no upstream')
        case 'gitPush':
          return okRemoteResult('pushed')
        default:
          return okRemoteResult('')
      }
    })

    const result = await pushRemoteBranch(TARGET, 'feature/test', { run: run as any })

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

  test('fetchRemoteRepository prefers the current branch upstream remote over fetch --all', async () => {
    const run = vi.fn(async (command: { type: string; remote?: string; branch?: string }) => {
      switch (command.type) {
        case 'gitSnapshot':
          return okRemoteResult(
            [
              '__GOBLIN_REMOTE_CURRENT__',
              'feature/test',
              '__GOBLIN_REMOTE_DEFAULT__',
              'main',
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
          return okRemoteResult('fork/feature/test')
        case 'gitFetchRemote':
          return okRemoteResult(`fetched ${command.remote}`)
        default:
          return okRemoteResult('')
      }
    })

    const result = await fetchRemoteRepository(TARGET, { run: run as any })

    expect(result).toEqual({ ok: true, message: 'fetched fork' })
    expect(run).toHaveBeenCalledWith({ type: 'gitFetchRemote', path: '/srv/repo', remote: 'fork' }, TARGET, {
      signal: undefined,
      timeoutMs: 180_000,
    })
    expect(run).not.toHaveBeenCalledWith({ type: 'gitFetchAll', path: '/srv/repo' }, TARGET, expect.anything())
  })

  test('getRemoteTrackingBranches filters */HEAD and malformed refs', async () => {
    const run = vi.fn(async () =>
      okRemoteResult(
        ['origin/HEAD', 'origin/main', 'origin/feature/auth', 'origin/feature/ui', 'not-a-valid-ref-line'].join('\n'),
      ),
    )
    const refs = await getRemoteTrackingBranches(TARGET, { run })
    expect(run).toHaveBeenCalledWith({ type: 'gitRemoteBranches', path: '/srv/repo' }, TARGET, { signal: undefined })
    expect(refs).toEqual(['origin/main', 'origin/feature/auth', 'origin/feature/ui'])
  })

  test('getRemoteTrackingBranches returns [] when the remote command fails', async () => {
    const run = vi.fn(async () => ({ ok: false, stdout: '', stderr: 'ssh: connection refused' }))
    const refs = await getRemoteTrackingBranches(TARGET, { run })
    expect(refs).toEqual([])
  })

  test('getRemoteWorktreeBootstrapPreview reads config without running bootstrap', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') {
        return okRemoteResult(
          '[worktree]\ncopy = [".env", "config/*"]\nsymlink = ["linked.txt"]\nexclude = ["config/*.log"]\nsetup = "bun install"',
        )
      }
      return okRemoteResult('')
    })

    const result = await getRemoteWorktreeBootstrapPreview(TARGET, { run: run as any })

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
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result).toEqual({ ok: true, message: '' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('bootstrapRemoteWorktreeAfterCreate runs remote bootstrap and formats output', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') {
        return okRemoteResult('[worktree]\ncopy = [".env"]\nsetup = "bun install"')
      }
      if (command.type === 'bootstrapRemoteWorktree') {
        return okRemoteResult('GOBLIN_BOOTSTRAP_COPY .env\nGOBLIN_BOOTSTRAP_SETUP bun install')
      }
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

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
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = ["other.env"]')
      if (command.type === 'bootstrapRemoteWorktree') return okRemoteResult('GOBLIN_BOOTSTRAP_COPY other.env')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', {
      run: run as any,
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
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'revParseTopLevel') return okRemoteResult('/srv/repo')
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = [".env"]')
      if (command.type === 'bootstrapRemoteWorktree') return okRemoteResult('GOBLIN_BOOTSTRAP_COPY .env')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(target, '/srv/repo-worktree', { run: run as any })

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
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = "not-an-array"')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Worktree bootstrap failed')
  })

  test('bootstrapRemoteWorktreeAfterCreate rejects unsafe paths before running remote bootstrap', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\ncopy = ["../secret.env"]')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('bootstrap path escapes repo root')
    expect(run).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
      expect.anything(),
      expect.anything(),
    )
  })

  test('bootstrapRemoteWorktreeAfterCreate returns error when remote bootstrap fails', async () => {
    const run = vi.fn(async (command: { type: string }) => {
      if (command.type === 'readRemoteFile') return okRemoteResult('[worktree]\nsetup = "bun install"')
      if (command.type === 'bootstrapRemoteWorktree') return failRemoteResult('bun: command not found')
      return okRemoteResult('')
    })

    const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run as any })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('bun: command not found')
  })

  test('getRemoteLog rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn()

    const entries = await getRemoteLog(TARGET, '../feature', undefined, undefined, { run: run as any })

    expect(entries).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  test('deleteRemoteBranch rejects unsafe branch names before running remote commands', async () => {
    const run = vi.fn()

    const result = await deleteRemoteBranch(TARGET, { branch: '../feature', run: run as any })

    expect(result).toEqual({ ok: false, message: 'error.invalid-arguments' })
    expect(run).not.toHaveBeenCalled()
  })
})

function okRemoteResult(stdout: string): RemoteCommandResult {
  return { ok: true, stdout, stderr: '' }
}

function failRemoteResult(message: string): RemoteCommandResult {
  return { ok: false, stdout: '', stderr: message, message }
}
