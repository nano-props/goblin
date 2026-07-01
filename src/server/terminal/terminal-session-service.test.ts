// @vitest-environment node

import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionService } from '#/server/terminal/terminal-session-service.ts'
import {
  createWorkspacePaneTabsRuntime,
  type WorkspacePaneTabsRuntime,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalAttachResult, TerminalSessionSummary } from '#/shared/terminal-types.ts'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => []),
}))

vi.mock('#/shared/worktree-guards.ts', () => ({
  resolveKnownWorktree: vi.fn(() => ({ ok: true, path: WORKTREE_PATH })),
}))

const USER_ID = 'user_terminal_service'
const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'

describe('terminal session service workspace tabs', () => {
  test('create returns canonical tabs without pre-existing stale terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: path.resolve(REPO_ROOT),
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneTerminalTabEntry('session-stale'), workspacePaneStaticTabEntry('status')],
    })
    let createdTerminalSessionId: string | null = null
    const service = createService({
      sessions: () => (createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []),
      workspaceTabs,
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        return {
          ok: true as const,
          ptySessionId: 'pty_session_created',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          controller: null,
          canonicalCols: input.cols,
          canonicalRows: input.rows,
        }
      }),
    })

    const result = await service.create('client_terminal_service', USER_ID, {
      repoRoot: REPO_ROOT,
      branch: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tabs).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry(result.terminalSessionId),
    ])
  })

  test('replaceTabs drops stale terminal tabs without appending missing live terminals', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneTerminalTabEntry('session-stale'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneTerminalTabEntry('session-live'),
        ],
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')])

    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: path.resolve(REPO_ROOT),
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')])

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('listWorkspaceTabs prunes stale terminal tabs without appending missing live terminals', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: path.resolve(REPO_ROOT),
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-stale'),
        workspacePaneTerminalTabEntry('session-live'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])

    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: path.resolve(REPO_ROOT),
      branchName: 'feature/static-only',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/static-only',
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
  })

  test('removeTerminalTab returns canonical tabs without unrelated stale terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: path.resolve(REPO_ROOT),
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneTerminalTabEntry('session-closed'),
        workspacePaneTerminalTabEntry('session-stale'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-live'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(service.removeTerminalTab(USER_ID, terminalSession('session-closed'))).resolves.toBeUndefined()
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: path.resolve(REPO_ROOT),
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-live'),
    ])
  })

  test('replaceTabs keeps no-worktree branch tabs server-owned and static-only', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const service = createService({
      sessions: [],
      workspaceTabs,
    })

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneTerminalTabEntry('session-stale'),
          workspacePaneStaticTabEntry('files'),
        ],
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status')])

    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: path.resolve(REPO_ROOT),
        branchName: 'feature/no-worktree',
        worktreePath: null,
      }),
    ).toEqual([workspacePaneStaticTabEntry('status')])
  })
})

function createService(options: {
  sessions: TerminalSessionSummary[] | (() => TerminalSessionSummary[])
  workspaceTabs: WorkspacePaneTabsRuntime<string>
  ensureSession?: (input: EnsureSessionInput) => Promise<TerminalAttachResult>
}) {
  return createTerminalSessionService({
    isValidClientId: (value): value is string => typeof value === 'string',
    isValidTerminalSessionId: (value): value is string => typeof value === 'string' && value.length > 0,
    manager: {
      ensureSession:
        options.ensureSession ??
        (async () => ({
          ok: false as const,
          message: 'unused',
        })),
      listSessionsForUser: vi.fn(async () =>
        typeof options.sessions === 'function' ? options.sessions() : options.sessions,
      ),
      closeSession: vi.fn(),
    },
    workspaceTabs: options.workspaceTabs,
    broadcastSessionsChanged: vi.fn(),
  })
}

interface EnsureSessionInput {
  terminalSessionId: string
  cols: number
  rows: number
}

function terminalSession(terminalSessionId: string): TerminalSessionSummary {
  return {
    ptySessionId: `pty_${terminalSessionId}`,
    terminalSessionId,
    repoRoot: path.resolve(REPO_ROOT),
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
