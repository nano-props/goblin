// @vitest-environment node

import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreator } from '#/server/terminal/terminal-session-creator.ts'
import type { ServerTerminalCreateInput } from '#/server/terminal/terminal-session-creator.ts'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type {
  TerminalSessionAdmissionCommitResult,
  TerminalSessionEnsureResult,
} from '#/server/terminal/terminal-session-ensurer.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const USER_ID = 'user_terminal_creator'
const CLIENT_ID = 'client_terminal_creator'
const TERMINAL_CLIENT_ID = 'client_terminal_controller'
const REPO_ROOT = 'goblin+file:///repo'
const REPO_RUNTIME_ID = 'repo-runtime-terminal-creator'
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'
const WORKSPACE_ID = requiredWorkspaceLocator(REPO_ROOT)
const WORKTREE_ROOT = requiredWorkspaceLocator('goblin+file:///repo/worktree')

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

describe('terminal session creator', () => {
  test('keeps the manager metadata revision when takeover advances current revision during stale validation', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      primaryTerminalSessionIdForWorktree: vi.fn(() => sessions[0]?.terminalSessionId ?? null),
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
      primaryTerminalSessionIdForWorktree: vi.fn(() => null),
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
      primaryTerminalSessionIdForWorktree: vi.fn(() => sessions[0]?.terminalSessionId ?? null),
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

function createRequest(overrides: Partial<ServerTerminalCreateInput> = {}): ServerTerminalCreateInput {
  return {
    ...overrides,
    target: overrides.target ?? {
      kind: 'git-worktree',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: REPO_RUNTIME_ID,
      root: WORKTREE_ROOT,
    },
    kind: overrides.kind ?? 'additional',
    cols: overrides.cols ?? 80,
    rows: overrides.rows ?? 24,
  }
}

function terminalSession(terminalSessionId: string): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    target: {
      kind: 'git-worktree',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: REPO_RUNTIME_ID,
      root: WORKTREE_ROOT,
    },
    presentation: { kind: 'git-worktree', branchName: BRANCH_NAME },
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

function committedResult(terminalRuntimeSessionId: string): TerminalSessionAdmissionCommitResult {
  return {
    action: 'created' as const,
    presentation: { kind: 'git-worktree', branchName: BRANCH_NAME },
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
