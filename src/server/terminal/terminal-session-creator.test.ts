// @vitest-environment node

import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreator } from '#/server/terminal/terminal-session-creator.ts'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { TerminalCreateInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { TerminalSessionEnsureResult } from '#/server/terminal/terminal-session-ensurer.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'

const USER_ID = 'user_terminal_creator'
const CLIENT_ID = 'client_terminal_creator'
const TERMINAL_CLIENT_ID = 'client_terminal_controller'
const REPO_ROOT = 'goblin+file:///repo'
const REPO_RUNTIME_ID = 'repo-runtime-terminal-creator'
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('terminal session creator', () => {
  test('keeps the manager metadata revision when takeover advances current revision during stale validation', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'term-createdcreatedcreated'))
      return ensureResult(input.terminalSessionId ?? 'term-createdcreatedcreated')
    })
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-createdcreatedcreated',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn(() => true),
    })

    const result = await creator.create({
      clientId: CLIENT_ID,
      terminalClientId: TERMINAL_CLIENT_ID,
      userId: USER_ID,
      request: createRequest(),
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      signal: new AbortController().signal,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ensureOrRestore).toHaveBeenCalledWith(
      CLIENT_ID,
      USER_ID,
      expect.objectContaining({
        clientId: TERMINAL_CLIENT_ID,
        terminalSessionId: 'term-createdcreatedcreated',
      }),
      testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      expect.any(AbortSignal),
    )
    expect(result).toMatchObject({
      terminalSessionId: 'term-createdcreatedcreated',
      admission: { kind: 'existing' },
      terminalRuntimeSessionId: 'pty_term-createdcreatedcreated',
    })
    expect(result).not.toHaveProperty('sessions')
  })

  test('rejects before ensuring when the repo runtime is already stale', async () => {
    const manager = {
      listSessionsForUser: vi.fn(async () => []),
    }
    const ensureOrRestore = vi.fn(async () => ensureResult('term-createdcreatedcreated'))
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-createdcreatedcreated',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn(() => false),
    })

    await expect(
      creator.create({
        clientId: CLIENT_ID,
        terminalClientId: TERMINAL_CLIENT_ID,
        userId: USER_ID,
        request: createRequest(),
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
    expect(ensureOrRestore).not.toHaveBeenCalled()
  })

  test('stops the create when the service rejects a stale runtime', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'term-createdcreatedcreated'))
      return ensureResult(input.terminalSessionId ?? 'term-createdcreatedcreated')
    })
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-createdcreatedcreated',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
    })

    await expect(
      creator.create({
        clientId: CLIENT_ID,
        terminalClientId: TERMINAL_CLIENT_ID,
        userId: USER_ID,
        request: createRequest(),
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
  })
})

function createRequest(overrides: Partial<TerminalCreateInput> = {}): TerminalCreateInput {
  return {
    repoRoot: REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
    branch: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    kind: 'additional',
    cols: 80,
    rows: 24,
    ...overrides,
  }
}

function terminalSession(terminalSessionId: string): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    repoRuntimeId: REPO_RUNTIME_ID,
    repoRoot: path.resolve(REPO_ROOT),
    branch: BRANCH_NAME,
    worktreePath: path.resolve(WORKTREE_PATH),
    cwd: path.resolve(WORKTREE_PATH),
    controller: null,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    cols: 80,
    rows: 24,
  }
}

function ensureResult(terminalSessionId: string): Extract<TerminalSessionEnsureResult, { ok: true }> {
  return {
    ok: true,
    admission: {
      kind: 'existing',
      commit: () => committedResult(`pty_${terminalSessionId}`),
      publishCommittedEffects: () => {},
      abort: () => {},
    },
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalSessionId,
  }
}

function committedResult(terminalRuntimeSessionId: string) {
  return {
    action: 'created' as const,
    branch: BRANCH_NAME,
    terminalSessionsRevision: 7,
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    controller: null,
    canonicalCols: 80,
    canonicalRows: 24,
  }
}
