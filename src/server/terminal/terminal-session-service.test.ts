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
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => []),
}))

vi.mock('#/shared/worktree-guards.ts', () => ({
  resolveKnownWorktree: vi.fn(() => ({ ok: true, path: WORKTREE_PATH })),
}))

const USER_ID = 'user_terminal_service'
const REPO_ROOT = '/repo'
const REPO_INSTANCE_ID = 'repo-instance-test'
const RUNTIME_SCOPE = terminalSessionRuntimeScope(REPO_ROOT, REPO_INSTANCE_ID)
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'
const REMOTE_REPO_ROOT = 'ssh-config://prod/srv/repo'
const REMOTE_REPO_INSTANCE_ID = 'repo-instance-remote-test'
const REMOTE_RUNTIME_SCOPE = terminalSessionRuntimeScope(REMOTE_REPO_ROOT, REMOTE_REPO_INSTANCE_ID)
const REMOTE_WORKTREE_PATH = '/srv/repo'
const REMOTE_BRANCH_NAME = 'feature/remote'

describe('terminal session service facade', () => {
  test('create returns canonical tabs without pre-existing stale terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
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
          terminalRuntimeSessionId: 'pty_session_created',
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
      repoInstanceId: REPO_INSTANCE_ID,
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

  test('create closes the runtime session when the repo instance goes stale after ensure', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    let current = true
    let createdTerminalSessionId: string | null = null
    const closeSession = vi.fn()
    const service = createService({
      sessions: () => (createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []),
      workspaceTabs,
      closeSession,
      isCurrentRepoInstance: () => current,
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        current = false
        return {
          ok: true as const,
          terminalRuntimeSessionId: 'pty_session_created',
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

    await expect(
      service.create('client_terminal_service', USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        kind: 'additional',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-instance-stale' })

    expect(closeSession).toHaveBeenCalledWith('pty_session_created')
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('create rejects before writing tabs when the repo instance goes stale during live-session lookup', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let current = true
    let createdTerminalSessionId: string | null = null
    let sessionListCalls = 0
    const closeSession = vi.fn()
    const service = createService({
      sessions: () => {
        sessionListCalls += 1
        if (sessionListCalls === 3) current = false
        return createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []
      },
      workspaceTabs,
      closeSession,
      isCurrentRepoInstance: () => current,
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        return terminalAttachResult(input)
      }),
    })

    await expect(
      service.create('client_terminal_service', USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        kind: 'additional',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-instance-stale' })

    expect(closeSession).toHaveBeenCalledWith('pty_session_created')
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: RUNTIME_SCOPE })).toEqual([])
  })

  test('create clears old-scope tabs when the repo instance goes stale after tab write', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    let currentCheckCount = 0
    let createdTerminalSessionId: string | null = null
    const closeSession = vi.fn()
    const service = createService({
      sessions: () => (createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []),
      workspaceTabs,
      closeSession,
      isCurrentRepoInstance: () => {
        currentCheckCount += 1
        return currentCheckCount < 5
      },
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        return terminalAttachResult(input)
      }),
    })

    await expect(
      service.create('client_terminal_service', USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        kind: 'additional',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-instance-stale' })

    expect(closeSession).toHaveBeenCalledWith('pty_session_created')
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: RUNTIME_SCOPE })).toEqual([])
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
        repoInstanceId: REPO_INSTANCE_ID,
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
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')])

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('replaceTabs rejects before writing when the repo instance goes stale during live-session lookup', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let current = true
    const service = createService({
      sessions: async () => {
        current = false
        return [terminalSession('session-live')]
      },
      workspaceTabs,
      isCurrentRepoInstance: () => current,
    })

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history'), workspacePaneTerminalTabEntry('session-live')],
      }),
    ).rejects.toThrow('error.repo-instance-stale')

    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('listWorkspaceTabs prunes stale terminal tabs and materializes live terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
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

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])

    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/static-only',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/static-only',
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('history'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])
  })

  test('preserves live terminal tabs after list canonicalization and later reorder operations', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneTerminalTabEntry('session-live'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [
          workspacePaneTerminalTabEntry('session-live'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
    ])

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'reorder', tabIdentities: ['workspace-pane:history', 'workspace-pane:status'] },
      }),
    ).resolves.toEqual([
      workspacePaneStaticTabEntry('history'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneTerminalTabEntry('session-live'),
    ])
  })

  test('listWorkspaceTabs projects terminal tabs from fresh worktree-scoped session state', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let sessionListCalls = 0
    const service = createService({
      sessions: () => {
        sessionListCalls += 1
        return sessionListCalls === 1 ? [terminalSession('session-closed')] : []
      },
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])
  })

  test('listWorkspaceTabs materializes tabs for worktrees discovered before projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])
  })

  test('reconcileTerminalTabsForSession returns canonical tabs without unrelated stale terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
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

    await expect(
      service.reconcileTerminalTabsForSession(USER_ID, terminalSession('session-closed')),
    ).resolves.toBeUndefined()
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')])
  })

  test('reconcileTerminalTabsForSession keeps the closed session id when it is still live', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
    })
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(
      service.reconcileTerminalTabsForSession(USER_ID, terminalSession('session-live')),
    ).resolves.toBeUndefined()
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')])
  })

  test('serializes terminal tab reconciliation with later workspace tab reorder operations', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneTerminalTabEntry('session-closed'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
      ],
    })
    const listSessionResolves: Array<(sessions: TerminalSessionSummary[]) => void> = []
    const service = createService({
      sessions: () =>
        new Promise<TerminalSessionSummary[]>((resolve) => {
          listSessionResolves.push(resolve)
        }),
      workspaceTabs,
    })

    const close = service.reconcileTerminalTabsForSession(USER_ID, terminalSession('session-closed'))
    await vi.waitFor(() => expect(listSessionResolves).toHaveLength(1))

    const reorder = service.updateTabs(USER_ID, {
      repoRoot: REPO_ROOT,
      repoInstanceId: REPO_INSTANCE_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      operation: { type: 'reorder', tabIdentities: ['workspace-pane:history', 'workspace-pane:status'] },
    })

    expect(listSessionResolves).toHaveLength(1)
    listSessionResolves[0]!([])
    await expect(close).resolves.toBeUndefined()
    await vi.waitFor(() => expect(listSessionResolves).toHaveLength(2))
    listSessionResolves[1]!([])

    await expect(reorder).resolves.toEqual([
      workspacePaneStaticTabEntry('history'),
      workspacePaneStaticTabEntry('status'),
    ])
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('status')])
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
        repoInstanceId: REPO_INSTANCE_ID,
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
        scope: RUNTIME_SCOPE,
        branchName: 'feature/no-worktree',
        worktreePath: null,
      }),
    ).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('updateTabs applies reorder to current server tabs without reviving stale static tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneTerminalTabEntry('session-live'),
        workspacePaneStaticTabEntry('history'),
        workspacePaneStaticTabEntry('status'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'close-static', tabType: 'history' },
      }),
    ).resolves.toEqual([workspacePaneTerminalTabEntry('session-live'), workspacePaneStaticTabEntry('status')])

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: {
          type: 'reorder',
          tabIdentities: ['workspace-pane:history', 'workspace-pane:status', 'terminal:session-live'],
        },
      }),
    ).resolves.toEqual([workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')])
  })

  test('updateTabs retargets worktree tabs when the worktree branch changes', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/old',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneTerminalTabEntry('session-live'), workspacePaneStaticTabEntry('status')],
    })
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
    })

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoInstanceId: REPO_INSTANCE_ID,
        branchName: 'feature/new',
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toEqual([
      workspacePaneTerminalTabEntry('session-live'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
    ])

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/new',
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [
          workspacePaneTerminalTabEntry('session-live'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
    ])
  })

  test('listWorkspaceTabs materializes missing terminal tabs without reverting current worktree branch', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/new',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const service = createService({
      sessions: [terminalSession('session-live', { branch: 'feature/old' })],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: 'feature/new',
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])
  })

  test('listWorkspaceTabs materializes missing terminal tabs from live sessions', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [terminalSession('session-live')],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-live')],
      },
    ])
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })

  test('listWorkspaceTabs does not materialize terminal tabs after repo instance goes stale during projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let current = true
    let listCount = 0
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: () => {
        listCount += 1
        if (listCount === 2) current = false
        return [terminalSession('session-live')]
      },
      workspaceTabs,
      isCurrentRepoInstance: () => current,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).rejects.toThrow(
      'error.repo-instance-stale',
    )
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([workspacePaneStaticTabEntry('status')])
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('listWorkspaceTabs materializes remote terminal tabs from session branch metadata', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: REMOTE_RUNTIME_SCOPE,
      branchName: REMOTE_BRANCH_NAME,
      worktreePath: REMOTE_WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [
        terminalSession('session-remote', {
          repoRoot: REMOTE_REPO_ROOT,
          repoInstanceId: REMOTE_REPO_INSTANCE_ID,
          branch: REMOTE_BRANCH_NAME,
          worktreePath: REMOTE_WORKTREE_PATH,
        }),
      ],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REMOTE_REPO_ROOT, REMOTE_REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REMOTE_REPO_ROOT,
        branchName: REMOTE_BRANCH_NAME,
        worktreePath: REMOTE_WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry('session-remote')],
      },
    ])
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith(USER_ID, REMOTE_REPO_ROOT)
  })

  test('listWorkspaceTabs prunes stale terminal tabs from the canonical projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneTerminalTabEntry('session-stale'), workspacePaneStaticTabEntry('status')],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_INSTANCE_ID)).resolves.toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
        tabs: [workspacePaneStaticTabEntry('status')],
      },
    ])
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith(USER_ID, REPO_ROOT)
  })
})

function createService(options: {
  sessions: TerminalSessionSummary[] | (() => TerminalSessionSummary[] | Promise<TerminalSessionSummary[]>)
  workspaceTabs: WorkspacePaneTabsRuntime<string>
  ensureSession?: (input: EnsureSessionInput) => Promise<TerminalAttachResult>
  closeSession?: (terminalRuntimeSessionId: string) => void
  isCurrentRepoInstance?: (userId: string, repoRoot: string, repoInstanceId: string) => boolean
  broadcastWorkspaceTabsChanged?: (userId: string, repoRoot: string) => void
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
      listSessionsForUser: vi.fn(
        async () => await (typeof options.sessions === 'function' ? options.sessions() : options.sessions),
      ),
      closeSession: options.closeSession ?? vi.fn(),
    },
    workspaceTabs: options.workspaceTabs,
    isCurrentRepoInstance: options.isCurrentRepoInstance ?? (() => true),
    broadcastSessionsChanged: vi.fn(),
    broadcastWorkspaceTabsChanged: options.broadcastWorkspaceTabsChanged ?? vi.fn(),
  })
}

interface EnsureSessionInput {
  terminalSessionId: string
  cols: number
  rows: number
}

function terminalSession(
  terminalSessionId: string,
  overrides: Partial<Pick<TerminalSessionSummary, 'repoRoot' | 'repoInstanceId' | 'branch' | 'worktreePath'>> = {},
): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalSessionId,
    repoInstanceId: overrides.repoInstanceId ?? REPO_INSTANCE_ID,
    repoRoot: overrides.repoRoot ?? path.resolve(REPO_ROOT),
    branch: overrides.branch ?? BRANCH_NAME,
    worktreePath: overrides.worktreePath ?? path.resolve(WORKTREE_PATH),
    cwd: overrides.worktreePath ?? path.resolve(WORKTREE_PATH),
    controller: null,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}

function terminalAttachResult(input: EnsureSessionInput): Extract<TerminalAttachResult, { ok: true }> {
  return {
    ok: true,
    terminalRuntimeSessionId: 'pty_session_created',
    snapshot: '',
    snapshotSeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: null,
    canonicalCols: input.cols,
    canonicalRows: input.rows,
  }
}
