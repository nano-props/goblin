// @vitest-environment node

import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalSessionEnsurer } from '#/server/terminal/terminal-session-ensurer.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import type { TerminalAttachResult } from '#/shared/terminal-types.ts'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => [
    { path: '/repo/worktree', branch: 'feature/worktree', isBare: false, isPrimary: false },
  ]),
}))

vi.mock('#/shared/worktree-guards.ts', () => ({
  resolveKnownWorktree: vi.fn(() => ({ ok: true, path: '/repo/worktree' })),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: vi.fn(async () => ({
    target: {
      id: 'ssh-config://prod/srv/repo',
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
  })),
}))

const USER_ID = 'user_terminal_ensurer'
const REPO_ROOT = '/repo'
const REPO_INSTANCE_ID = 'repo-instance-ensure'
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'
const REMOTE_REPO_ROOT = 'ssh-config://prod/srv/repo'
const REMOTE_WORKTREE_PATH = '/srv/repo'

describe('terminal session ensurer', () => {
  beforeEach(() => {
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: WORKTREE_PATH, branch: BRANCH_NAME, isBare: false, isPrimary: false },
    ])
    vi.mocked(resolveKnownWorktree).mockReturnValue({ ok: true, path: WORKTREE_PATH })
    vi.mocked(resolveRemoteTarget).mockResolvedValue({
      target: {
        id: REMOTE_REPO_ROOT,
        alias: 'prod',
        host: 'example.test',
        user: 'deploy',
        port: 22,
        remotePath: REMOTE_WORKTREE_PATH,
        displayName: 'prod:repo',
      },
    })
  })

  test('ensures local terminal sessions with resolved worktree metadata', async () => {
    const ensureSession = vi.fn(async (input) => attachResult(input.terminalSessionId, input.cols, input.rows))
    const broadcastSessionsChanged = vi.fn()
    const ensurer = createTerminalSessionEnsurer({
      manager: { ensureSession },
      broadcastSessionsChanged,
    })

    const result = await ensurer.ensure(
      USER_ID,
      {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        startupShellCommand: 'echo ready',
        clientId: 'client_terminal_ensurer',
      },
      {
        terminalSessionId: 'term-locallocallocallocal1',
        cols: 100,
        rows: 40,
        scopedWorktreePath: path.resolve(WORKTREE_PATH),
        action: 'created',
      },
    )

    expect(result).toMatchObject({
      ok: true,
      action: 'created',
      terminalSessionId: 'term-locallocallocallocal1',
      canonicalCols: 100,
      canonicalRows: 40,
    })
    expect(getWorktrees).toHaveBeenCalledWith(REPO_ROOT, { includeStatus: false })
    expect(resolveKnownWorktree).toHaveBeenCalledWith(
      [{ path: WORKTREE_PATH, branch: BRANCH_NAME, isBare: false, isPrimary: false }],
      WORKTREE_PATH,
      BRANCH_NAME,
    )
    expect(ensureSession).toHaveBeenCalledWith({
      userId: USER_ID,
      scope: terminalSessionRuntimeScope(REPO_ROOT, REPO_INSTANCE_ID),
      repoRoot: path.resolve(REPO_ROOT),
      repoInstanceId: REPO_INSTANCE_ID,
      branch: BRANCH_NAME,
      terminalSessionId: 'term-locallocallocallocal1',
      worktreePath: path.resolve(WORKTREE_PATH),
      cwd: path.resolve(WORKTREE_PATH),
      cols: 100,
      rows: 40,
      clientId: 'client_terminal_ensurer',
      startupShellCommand: 'echo ready',
      env: undefined,
    })
    expect(broadcastSessionsChanged).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })

  test('returns the worktree resolution failure without ensuring a session', async () => {
    vi.mocked(resolveKnownWorktree).mockReturnValueOnce({
      ok: false,
      message: 'error.worktree-not-found-for-branch',
    })
    const ensureSession = vi.fn(async (input) => attachResult(input.terminalSessionId, input.cols, input.rows))
    const broadcastSessionsChanged = vi.fn()
    const ensurer = createTerminalSessionEnsurer({
      manager: { ensureSession },
      broadcastSessionsChanged,
    })

    await expect(
      ensurer.ensure(
        USER_ID,
        {
          repoRoot: REPO_ROOT,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
        },
        {
          terminalSessionId: 'term-locallocallocallocal1',
          cols: 80,
          rows: 24,
          scopedWorktreePath: path.resolve(WORKTREE_PATH),
          action: 'created',
        },
      ),
    ).resolves.toEqual({ ok: false, message: 'error.worktree-not-found-for-branch' })
    expect(ensureSession).not.toHaveBeenCalled()
    expect(broadcastSessionsChanged).not.toHaveBeenCalled()
  })

  test('ensures remote terminal sessions through an SSH invocation', async () => {
    const ensureSession = vi.fn(async (input) => attachResult(input.terminalSessionId, input.cols, input.rows))
    const broadcastSessionsChanged = vi.fn()
    const ensurer = createTerminalSessionEnsurer({
      manager: { ensureSession },
      broadcastSessionsChanged,
    })

    const result = await ensurer.ensure(
      USER_ID,
      {
        repoRoot: REMOTE_REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branch: BRANCH_NAME,
        worktreePath: REMOTE_WORKTREE_PATH,
        startupShellCommand: 'pwd',
      },
      {
        terminalSessionId: 'term-remoteremoteremote001',
        cols: 120,
        rows: 32,
        scopedWorktreePath: REMOTE_WORKTREE_PATH,
        action: 'reused',
      },
    )

    expect(result).toMatchObject({
      ok: true,
      action: 'reused',
      terminalSessionId: 'term-remoteremoteremote001',
      canonicalCols: 120,
      canonicalRows: 32,
    })
    expect(resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: REMOTE_WORKTREE_PATH })
    expect(ensureSession).toHaveBeenCalledTimes(1)
    const input = ensureSession.mock.calls[0]?.[0]
    expect(input).toEqual(
      expect.objectContaining({
        userId: USER_ID,
        scope: terminalSessionRuntimeScope(REMOTE_REPO_ROOT, REPO_INSTANCE_ID),
        repoRoot: REMOTE_REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branch: BRANCH_NAME,
        terminalSessionId: 'term-remoteremoteremote001',
        worktreePath: REMOTE_WORKTREE_PATH,
        cwd: process.cwd(),
        cols: 120,
        rows: 32,
      }),
    )
    expect(input?.command).toBeTruthy()
    expect(input?.args).toEqual(expect.arrayContaining(['-tt', '--', 'prod']))
    expect(input?.args?.at(-1)).toContain(REMOTE_WORKTREE_PATH)
    expect(input?.args?.at(-1)).toContain('pwd')
    expect(input?.startupShellCommand).toBeUndefined()
    expect(broadcastSessionsChanged).toHaveBeenCalledWith(USER_ID, REMOTE_REPO_ROOT)
  })

  test('returns remote config errors without ensuring a session', async () => {
    vi.mocked(resolveRemoteTarget).mockRejectedValueOnce(new Error('error.ssh-config-changed'))
    const ensureSession = vi.fn(async (input) => attachResult(input.terminalSessionId, input.cols, input.rows))
    const broadcastSessionsChanged = vi.fn()
    const ensurer = createTerminalSessionEnsurer({
      manager: { ensureSession },
      broadcastSessionsChanged,
    })

    await expect(
      ensurer.ensure(
        USER_ID,
        {
          repoRoot: REMOTE_REPO_ROOT,
          repoInstanceId: REPO_INSTANCE_ID,
          branch: BRANCH_NAME,
          worktreePath: REMOTE_WORKTREE_PATH,
        },
        {
          terminalSessionId: 'term-remoteremoteremote001',
          cols: 80,
          rows: 24,
          scopedWorktreePath: REMOTE_WORKTREE_PATH,
          action: 'created',
        },
      ),
    ).resolves.toEqual({ ok: false, message: 'error.ssh-config-changed' })
    expect(ensureSession).not.toHaveBeenCalled()
    expect(broadcastSessionsChanged).not.toHaveBeenCalled()
  })
})

function attachResult(
  terminalSessionId: string,
  cols: number,
  rows: number,
): Extract<TerminalAttachResult, { ok: true }> {
  return {
    ok: true,
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    snapshot: '',
    snapshotSeq: 0,
   outputEra: 0,

    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: null,
    canonicalCols: cols,
    canonicalRows: rows,
  }
}
