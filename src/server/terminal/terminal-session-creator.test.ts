// @vitest-environment node

import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreator } from '#/server/terminal/terminal-session-creator.ts'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import type { TerminalCreateInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { TerminalSessionEnsureResult } from '#/server/terminal/terminal-session-ensurer.ts'

const USER_ID = 'user_terminal_creator'
const CLIENT_ID = 'client_terminal_creator'
const TERMINAL_CLIENT_ID = 'client_terminal_controller'
const REPO_ROOT = '/repo'
const REPO_RUNTIME_ID = 'repo-runtime-terminal-creator'
const SCOPE = terminalSessionRuntimeScope(REPO_ROOT, REPO_RUNTIME_ID)
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('terminal session creator', () => {
  test('creates a session and returns terminal sessions without mutating workspace tabs', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'term-createdcreatedcreated'))
      return ensureResult(input.terminalSessionId ?? 'term-createdcreatedcreated')
    })
    const cleanupStaleCreate = vi.fn(async () => {})
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-createdcreatedcreated',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn(() => true),
      rejectStaleCreateIfNeeded: vi.fn(() => null),
      cleanupStaleCreate,
      listSessions: vi.fn(async () => sessions),
    })

    const result = await creator.create({
      clientId: CLIENT_ID,
      terminalClientId: TERMINAL_CLIENT_ID,
      userId: USER_ID,
      request: createRequest(),
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
    )
    expect(result.sessions).toEqual([terminalSession('term-createdcreatedcreated')])
    expect(cleanupStaleCreate).not.toHaveBeenCalled()
  })

  test('returns terminal sessions in service order', async () => {
    const sessions: TerminalSessionSummary[] = [terminalSession('term-111111111111111111111'), terminalSession('term-222222222222222222222')]
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'term-333333333333333333333'))
      return ensureResult(input.terminalSessionId ?? 'term-333333333333333333333')
    })
    const cleanupStaleCreate = vi.fn(async () => {})
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-333333333333333333333',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn(() => true),
      rejectStaleCreateIfNeeded: vi.fn(() => null),
      cleanupStaleCreate,
      listSessions: vi.fn(async () => sessions),
    })

    const result = await creator.create({
      clientId: CLIENT_ID,
      terminalClientId: TERMINAL_CLIENT_ID,
      userId: USER_ID,
      request: createRequest(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sessions.map((session) => session.terminalSessionId)).toEqual([
      'term-111111111111111111111',
      'term-222222222222222222222',
      'term-333333333333333333333',
    ])
    expect(cleanupStaleCreate).not.toHaveBeenCalled()
  })

  test('rejects before ensuring when the repo runtime is already stale', async () => {
    const manager = {
      listSessionsForUser: vi.fn(async () => []),
    }
    const ensureOrRestore = vi.fn(async () => ensureResult('term-createdcreatedcreated'))
    const cleanupStaleCreate = vi.fn(async () => {})
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-createdcreatedcreated',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn(() => false),
      rejectStaleCreateIfNeeded: vi.fn(() => null),
      cleanupStaleCreate,
      listSessions: vi.fn(async () => []),
    })

    await expect(
      creator.create({
        clientId: CLIENT_ID,
        terminalClientId: TERMINAL_CLIENT_ID,
        userId: USER_ID,
        request: createRequest(),
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
    expect(ensureOrRestore).not.toHaveBeenCalled()
    expect(cleanupStaleCreate).not.toHaveBeenCalled()
  })

  test('lets stale cleanup stop the create before tab materialization', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'term-createdcreatedcreated'))
      return ensureResult(input.terminalSessionId ?? 'term-createdcreatedcreated')
    })
    const rejectStaleCreateIfNeeded = vi.fn(() => ({ ok: false as const, message: 'error.repo-runtime-stale' }))
    const cleanupStaleCreate = vi.fn(async () => {
      workspaceTabs.closeTabsForScope(USER_ID, SCOPE)
    })
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'term-createdcreatedcreated',
      }),
      ensureOrRestore,
      isCurrentRepoRuntime: vi.fn(() => true),
      rejectStaleCreateIfNeeded,
      cleanupStaleCreate,
      listSessions: vi.fn(async () => sessions),
    })

    await expect(
      creator.create({
        clientId: CLIENT_ID,
        terminalClientId: TERMINAL_CLIENT_ID,
        userId: USER_ID,
        request: createRequest(),
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
    expect(rejectStaleCreateIfNeeded).toHaveBeenCalledTimes(1)
    expect(cleanupStaleCreate).toHaveBeenCalledWith(USER_ID, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      cols: 80,
      rows: 24,
    })
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([])
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
    terminalSessionId,
    repoRuntimeId: REPO_RUNTIME_ID,
    repoRoot: path.resolve(REPO_ROOT),
    branch: BRANCH_NAME,
    worktreePath: path.resolve(WORKTREE_PATH),
    cwd: path.resolve(WORKTREE_PATH),
    controller: null,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}

function ensureResult(terminalSessionId: string): Extract<TerminalSessionEnsureResult, { ok: true }> {
  return {
    ok: true,
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalSessionId,
    action: 'created',
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    snapshot: '',
    snapshotSeq: 0,
    outputEra: 0,

    controller: null,
    canonicalCols: 80,
    canonicalRows: 24,
  }
}
