// @vitest-environment node

import path from 'node:path'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createTerminalSessionEnsurer,
  type TerminalSessionEnsureContext,
} from '#/server/terminal/terminal-session-ensurer.ts'
import { issueTestPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import type { TerminalSessionPrepareManagerResult } from '#/server/terminal/terminal-session-ensurer.ts'

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
  resolveRemoteTargetWithConfigFingerprint: vi.fn(),
}))

const USER_ID = 'user_terminal_ensurer'
const REPO_ROOT = '/repo'
const REPO_RUNTIME_ID = 'repo-runtime-ensure'
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'
const REMOTE_REPO_ROOT = 'ssh-config://prod/srv/repo'
const REMOTE_WORKTREE_PATH = '/srv/repo'

function ensureContext(context: Omit<TerminalSessionEnsureContext, 'signal'>): TerminalSessionEnsureContext {
  return { ...context, signal: new AbortController().signal }
}

function remotePhysicalWorktreeExecutionCapability() {
  return issueTestPhysicalWorktreeExecutionCapability({
    identity: {
      kind: 'remote',
      executionNamespaceId: '0123456789abcdef0123456789abcdef',
      endpoint: REMOTE_WORKTREE_PATH,
    },
    userId: USER_ID,
    repoRoot: REMOTE_REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
    worktreePath: REMOTE_WORKTREE_PATH,
    execution: {
      kind: 'remote',
      canonicalWorktreePath: REMOTE_WORKTREE_PATH,
      configFingerprint: 'ensurer-test-config',
      endpointMarker: { deviceId: '10', inode: '20' },
      target: {
        id: REMOTE_REPO_ROOT,
        alias: 'prod',
        host: 'example.test',
        user: 'deploy',
        port: 22,
        remotePath: REMOTE_WORKTREE_PATH,
        displayName: 'prod:repo',
      },
    },
  })
}

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
    const prepareSession = vi.fn(async (input) => preparedResult(input.terminalSessionId, input.cols, input.rows))
    const ensurer = createTerminalSessionEnsurer({
      manager: { prepareSession },
    })

    const context = ensureContext({
      terminalSessionId: 'term-locallocallocallocal1',
      cols: 100,
      rows: 40,
      scopedWorktreePath: path.resolve(WORKTREE_PATH),
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
    })
    const result = await ensurer.ensure(
      USER_ID,
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        startupShellCommand: 'echo ready',
        clientId: 'client_terminal_ensurer',
      },
      context,
    )

    expect(result).toMatchObject({
      ok: true,
      admission: { kind: 'existing', terminalSessionsRevision: 7 },
      terminalSessionId: 'term-locallocallocallocal1',
      canonicalCols: 100,
      canonicalRows: 40,
    })
    expect(getWorktrees).not.toHaveBeenCalled()
    expect(resolveKnownWorktree).not.toHaveBeenCalled()
    expect(prepareSession).toHaveBeenCalledWith({
      userId: USER_ID,
      scope: terminalSessionRuntimeScope(REPO_ROOT, REPO_RUNTIME_ID),
      repoRoot: path.resolve(REPO_ROOT),
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: BRANCH_NAME,
      terminalSessionId: 'term-locallocallocallocal1',
      worktreePath: path.resolve(WORKTREE_PATH),
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: path.resolve(WORKTREE_PATH),
      cols: 100,
      rows: 40,
      clientId: 'client_terminal_ensurer',
      startupShellCommand: 'echo ready',
      env: undefined,
      signal: context.signal,
    })
  })

  test('ensures remote terminal sessions through an SSH invocation', async () => {
    const prepareSession = vi.fn(async (input) => preparedResult(input.terminalSessionId, input.cols, input.rows))
    const ensurer = createTerminalSessionEnsurer({
      manager: { prepareSession },
    })

    const result = await ensurer.ensure(
      USER_ID,
      {
        repoRoot: REMOTE_REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH_NAME,
        worktreePath: REMOTE_WORKTREE_PATH,
        startupShellCommand: 'pwd',
      },
      ensureContext({
        terminalSessionId: 'term-remoteremoteremote001',
        cols: 120,
        rows: 32,
        scopedWorktreePath: REMOTE_WORKTREE_PATH,
        physicalWorktreeCapability: remotePhysicalWorktreeExecutionCapability(),
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      action: 'created',
      terminalSessionId: 'term-remoteremoteremote001',
      canonicalCols: 120,
      canonicalRows: 32,
    })
    expect(resolveRemoteTarget).not.toHaveBeenCalled()
    expect(prepareSession).toHaveBeenCalledTimes(1)
    const input = prepareSession.mock.calls[0]?.[0]
    expect(input).toEqual(
      expect.objectContaining({
        userId: USER_ID,
        scope: terminalSessionRuntimeScope(REMOTE_REPO_ROOT, REPO_RUNTIME_ID),
        repoRoot: REMOTE_REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH_NAME,
        terminalSessionId: 'term-remoteremoteremote001',
        worktreePath: REMOTE_WORKTREE_PATH,
        physicalWorktreeCapability: remotePhysicalWorktreeExecutionCapability(),
        cwd: process.cwd(),
        cols: 120,
        rows: 32,
      }),
    )
    expect(input?.command).toBeTruthy()
    expect(input?.args).toEqual(expect.arrayContaining(['-F', '/dev/null', '-tt', 'hostname=example.test']))
    expect(input?.args?.at(-2)).toBe('prod')
    expect(input?.args?.at(-1)).toContain(REMOTE_WORKTREE_PATH)
    expect(input?.args?.at(-1)).toContain('pwd')
    expect(input?.startupShellCommand).toBeUndefined()
  })

  test('uses the captured remote target after SSH config changes', async () => {
    vi.mocked(resolveRemoteTarget).mockRejectedValueOnce(new Error('error.ssh-config-changed'))
    const prepareSession = vi.fn(async (input) => preparedResult(input.terminalSessionId, input.cols, input.rows))
    const ensurer = createTerminalSessionEnsurer({
      manager: { prepareSession },
    })

    await expect(
      ensurer.ensure(
        USER_ID,
        {
          repoRoot: REMOTE_REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: BRANCH_NAME,
          worktreePath: REMOTE_WORKTREE_PATH,
        },
        ensureContext({
          terminalSessionId: 'term-remoteremoteremote001',
          cols: 80,
          rows: 24,
          scopedWorktreePath: REMOTE_WORKTREE_PATH,
          physicalWorktreeCapability: remotePhysicalWorktreeExecutionCapability(),
        }),
      ),
    ).resolves.toMatchObject({ ok: true })
    expect(resolveRemoteTarget).not.toHaveBeenCalled()
    expect(prepareSession).toHaveBeenCalledOnce()
  })
})

function preparedResult(
  terminalSessionId: string,
  cols: number,
  rows: number,
): Extract<TerminalSessionPrepareManagerResult, { ok: true }> {
  return {
    ok: true,
    action: 'created',
    admission: { kind: 'existing', terminalSessionsRevision: 7 },
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalRuntimeGeneration: 1,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: null,
    canonicalCols: cols,
    canonicalRows: rows,
  }
}
