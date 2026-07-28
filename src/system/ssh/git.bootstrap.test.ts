import { describe, expect, test, vi } from 'vitest'
import {
  bootstrapRemoteWorktreeAfterCreate,
  deleteRemoteBranch,
  getRemoteLog,
  getRemoteWorktreeBootstrapPreview,
  type RemoteGitRunner,
} from '#/system/ssh/git.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteCommandResult } from '#/system/ssh/commands.ts'
import { worktreeBootstrapConfigHash } from '#/system/git/worktree-bootstrap.ts'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { TARGET, failRemoteResult, okRemoteResult } from '#/system/ssh/git-test-utils.ts'

describe('remote git bootstrap', () => {
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

  test.each([
    ['invalid field type', '[worktree]\ncopy = "not-an-array"', 'Worktree bootstrap failed'],
    ['path escaping the repo root', '[worktree]\ncopy = ["../secret.env"]', 'bootstrap path escapes repo root'],
  ] as const)(
    'bootstrapRemoteWorktreeAfterCreate rejects %s before remote bootstrap',
    async (_label, config, message) => {
      const run = vi.fn<RemoteGitRunner>(async (command: { type: string }) => {
        if (command.type === 'readRemoteFile') return okRemoteResult(config)
        return okRemoteResult('')
      })

      const result = await bootstrapRemoteWorktreeAfterCreate(TARGET, '/srv/repo-worktree', { run: run })

      expect(result.ok).toBe(false)
      expect(result.message).toContain(message)
      expect(run).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'bootstrapRemoteWorktree' }),
        expect.anything(),
        expect.anything(),
      )
    },
  )

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
