// @vitest-environment node

import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreator } from '#/server/terminal/terminal-session-creator.ts'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalCreateInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { TerminalSessionEnsureResult } from '#/server/terminal/terminal-session-ensurer.ts'

const USER_ID = 'user_terminal_creator'
const CLIENT_ID = 'client_terminal_creator'
const TERMINAL_CLIENT_ID = 'client_terminal_controller'
const REPO_ROOT = '/repo'
const REPO_INSTANCE_ID = 'repo-instance-terminal-creator'
const SCOPE = terminalSessionRuntimeScope(REPO_ROOT, REPO_INSTANCE_ID)
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('terminal session creator', () => {
  test('creates a session and returns canonical tabs and sessions', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneRuntimeTabEntry('terminal', 'session-stale'), workspacePaneStaticTabEntry('status')],
    })
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'session-created'))
      return ensureResult(input.terminalSessionId ?? 'session-created')
    })
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'session-created',
      }),
      workspaceTabsCoordinator: createWorkspacePaneTabsCoordinator({
        workspaceTabs,
        runtimeProviders: [terminalRuntimeTabsProvider(manager)],
      }),
      ensureOrRestore,
      isCurrentRepoInstance: vi.fn(() => true),
      rejectStaleCreateIfNeeded: vi.fn(() => null),
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
        terminalSessionId: 'session-created',
      }),
    )
    expect(result.sessions).toEqual([terminalSession('session-created')])
    expect(result.tabs).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'session-created'),
    ])
  })

  test('rejects before ensuring when the repo instance is already stale', async () => {
    const manager = {
      listSessionsForUser: vi.fn(async () => []),
    }
    const ensureOrRestore = vi.fn(async () => ensureResult('session-created'))
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'session-created',
      }),
      workspaceTabsCoordinator: createWorkspacePaneTabsCoordinator({
        workspaceTabs: createWorkspacePaneTabsRuntime<string>(),
        runtimeProviders: [terminalRuntimeTabsProvider(manager)],
      }),
      ensureOrRestore,
      isCurrentRepoInstance: vi.fn(() => false),
      rejectStaleCreateIfNeeded: vi.fn(() => null),
      listSessions: vi.fn(async () => []),
    })

    await expect(
      creator.create({
        clientId: CLIENT_ID,
        terminalClientId: TERMINAL_CLIENT_ID,
        userId: USER_ID,
        request: createRequest(),
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-instance-stale' })
    expect(ensureOrRestore).not.toHaveBeenCalled()
  })

  test('lets stale cleanup stop the create before tab materialization', async () => {
    const sessions: TerminalSessionSummary[] = []
    const manager = {
      listSessionsForUser: vi.fn(async () => sessions),
    }
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const ensureOrRestore = vi.fn(async (_clientId, _userId, input) => {
      sessions.push(terminalSession(input.terminalSessionId ?? 'session-created'))
      return ensureResult(input.terminalSessionId ?? 'session-created')
    })
    const rejectStaleCreateIfNeeded = vi.fn(() => ({ ok: false as const, message: 'error.repo-instance-stale' }))
    const creator = createTerminalSessionCreator({
      createCoordinator: createTerminalSessionCreateCoordinator({
        manager,
        createSessionId: () => 'session-created',
      }),
      workspaceTabsCoordinator: createWorkspacePaneTabsCoordinator({
        workspaceTabs,
        runtimeProviders: [terminalRuntimeTabsProvider(manager)],
      }),
      ensureOrRestore,
      isCurrentRepoInstance: vi.fn(() => true),
      rejectStaleCreateIfNeeded,
      listSessions: vi.fn(async () => sessions),
    })

    await expect(
      creator.create({
        clientId: CLIENT_ID,
        terminalClientId: TERMINAL_CLIENT_ID,
        userId: USER_ID,
        request: createRequest(),
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-instance-stale' })
    expect(rejectStaleCreateIfNeeded).toHaveBeenCalledTimes(1)
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([])
  })
})

function createRequest(overrides: Partial<TerminalCreateInput> = {}): TerminalCreateInput {
  return {
    repoRoot: REPO_ROOT,
    repoInstanceId: REPO_INSTANCE_ID,
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
    repoInstanceId: REPO_INSTANCE_ID,
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

function terminalRuntimeTabsProvider(manager: {
  listSessionsForUser(userId: string, scope: string): Promise<TerminalSessionSummary[]>
}) {
  return {
    type: 'terminal' as const,
    async listSessionsForUser(userId: string, scope: string) {
      return (await manager.listSessionsForUser(userId, scope)).map((session) => ({
        sessionId: session.terminalSessionId,
        branch: session.branch,
        worktreePath: session.worktreePath,
      }))
    },
  }
}
