// @vitest-environment node

import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  createTerminalSessionService,
  terminalWorkspacePaneRuntimeTabsProvider,
} from '#/server/terminal/terminal-session-service.ts'
import {
  createWorkspacePaneTabsRuntime,
  type WorkspacePaneTabsRuntime,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  replaceTestWorkspaceTabs,
  testPhysicalWorktreeCapability,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalCreateInput, TerminalSessionSummary } from '#/shared/terminal-types.ts'
import type { TerminalSessionEnsureAttachResult } from '#/server/terminal/terminal-session-ensurer.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => []),
}))

vi.mock('#/shared/worktree-guards.ts', () => ({
  resolveKnownWorktree: vi.fn(() => ({ ok: true, path: WORKTREE_PATH })),
}))

const USER_ID = 'user_terminal_service'
const REPO_ROOT = '/repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const RUNTIME_SCOPE = terminalSessionRuntimeScope(REPO_ROOT, REPO_RUNTIME_ID)
const WORKTREE_PATH = '/repo/worktree'
const BRANCH_NAME = 'feature/worktree'
const REMOTE_REPO_ROOT = 'ssh-config://prod/srv/repo'
const REMOTE_REPO_RUNTIME_ID = 'repo-runtime-remote-test'
const REMOTE_RUNTIME_SCOPE = terminalSessionRuntimeScope(REMOTE_REPO_ROOT, REMOTE_REPO_RUNTIME_ID)
const REMOTE_WORKTREE_PATH = '/srv/repo'
const REMOTE_BRANCH_NAME = 'feature/remote'

describe('terminal session service facade', () => {
  test('create returns canonical tabs without pre-existing stale terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
        workspacePaneStaticTabEntry('status'),
      ],
    })
    let createdTerminalSessionId: string | null = null
    const service = createService({
      sessions: () => (createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []),
      workspaceTabs,
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        return {
          ok: true as const,
          terminalSessionsRevision: 1,
          terminalRuntimeSessionId: 'pty_session_created',
        terminalRuntimeGeneration: 1,
          snapshot: '',
          snapshotSeq: 0,
          outputEra: 0,

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

    const result = await createTerminal(service, 'client_terminal_service', USER_ID, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      kind: 'additional',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: terminalSessionRuntimeScope(REPO_ROOT, REPO_RUNTIME_ID),
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
      }),
    ).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
      workspacePaneStaticTabEntry('status'),
    ])
  })

  test('create closes its runtime session without clearing the stale runtime projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const existingTabs = [
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-existingexisting001'),
    ]
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: existingTabs,
    })
    let current = true
    let createdTerminalSessionId: string | null = null
    const closeSession = vi.fn(async () => true)
    const service = createService({
      sessions: () => (createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []),
      workspaceTabs,
      closeSession,
      isCurrentRepoRuntime: () => current,
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        current = false
        return {
          ok: true as const,
          terminalSessionsRevision: 1,
          terminalRuntimeSessionId: 'pty_session_created',
        terminalRuntimeGeneration: 1,
          snapshot: '',
          snapshotSeq: 0,
          outputEra: 0,

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
      createTerminal(service, 'client_terminal_service', USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        kind: 'additional',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })

    expect(closeSession).toHaveBeenCalledWith('pty_session_created')
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual(existingTabs)
  })

  test('keeps the stale runtime projection when its session close is not acknowledged', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-existingexisting001'),
      ],
    })
    let current = true
    const closeSession = vi.fn(async () => false)
    const service = createService({
      sessions: [terminalSession('term-existingexisting001')],
      workspaceTabs,
      closeSession,
      isCurrentRepoRuntime: () => current,
      ensureSession: vi.fn(async (input) => {
        current = false
        return terminalAttachResult(input)
      }),
    })

    await expect(
      createTerminal(service, 'client_terminal_service', USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        kind: 'additional',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })

    expect(closeSession).toHaveBeenCalledOnce()
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-existingexisting001'),
    ])
  })

  test('create rejects before writing tabs when the repo runtime goes stale during live-session lookup', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let createdTerminalSessionId: string | null = null
    let leaseChecks = 0
    const closeSession = vi.fn(async () => true)
    const service = createService({
      sessions: () => (createdTerminalSessionId ? [terminalSession(createdTerminalSessionId)] : []),
      workspaceTabs,
      closeSession,
      isCurrentRepoRuntime: () => {
        leaseChecks += 1
        return leaseChecks === 1
      },
      ensureSession: vi.fn(async (input) => {
        createdTerminalSessionId = input.terminalSessionId
        return terminalAttachResult(input)
      }),
    })

    await expect(
      createTerminal(service, 'client_terminal_service', USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        kind: 'additional',
        cols: 80,
        rows: 24,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })

    expect(leaseChecks).toBe(2)
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

  test('ensureOrRestore reports created reused and restored from matching session state', async () => {
    const ensureSession = vi.fn(async (input) => terminalAttachResult(input))
    const ensureInput = {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      terminalSessionId: 'term-actionactionaction001',
      cols: 80,
      rows: 24,
    }

    const createdService = createService({
      sessions: [],
      workspaceTabs: createWorkspacePaneTabsRuntime<string>(),
      ensureSession,
    })
    await expect(
      ensureOrRestore(createdService, 'client_terminal_service', USER_ID, ensureInput),
    ).resolves.toMatchObject({
      ok: true,
      action: 'created',
      terminalSessionId: 'term-actionactionaction001',
    })

    const reusedService = createService({
      sessions: [terminalSession('term-actionactionaction001')],
      workspaceTabs: createWorkspacePaneTabsRuntime<string>(),
      ensureSession,
    })
    await expect(ensureOrRestore(reusedService, 'client_terminal_service', USER_ID, ensureInput)).resolves.toMatchObject(
      {
        ok: true,
        action: 'reused',
        terminalSessionId: 'term-actionactionaction001',
      },
    )

    const restoredService = createService({
      sessions: [
        {
          ...terminalSession('term-actionactionaction001'),
          controller: { clientId: 'client_existing_controller', status: 'connected' },
        },
      ],
      workspaceTabs: createWorkspacePaneTabsRuntime<string>(),
      ensureSession,
    })
    await expect(
      ensureOrRestore(restoredService, 'client_terminal_service', USER_ID, ensureInput),
    ).resolves.toMatchObject({
      ok: true,
      action: 'restored',
      terminalSessionId: 'term-actionactionaction001',
    })
  })

  test('replaceTabs drops stale terminal tabs and materializes missing live terminals', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        ],
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })

    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
    ])

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('replaceTabs rejects before writing when the repo runtime goes stale during live-session lookup', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
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
        return [terminalSession('term-livelivelivelivelive1')]
      },
      workspaceTabs,
      isCurrentRepoRuntime: () => current,
    })

    await expect(
      service.replaceTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneStaticTabEntry('history'),
          workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        ],
      }),
    ).rejects.toThrow('error.repo-runtime-stale')

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
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })

    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/static-only',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'feature/static-only',
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('history'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('listWorkspaceTabs reconciles multiple worktrees with one projection broadcast', async () => {
    const otherWorktreePath = '/repo/other-worktree'
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ],
    })
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/other-worktree',
      worktreePath: path.resolve(otherWorktreePath),
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [
        terminalSession('term-livelivelivelivelive1'),
        terminalSession('term-otherworktreeotherwo1', {
          branch: 'feature/other-worktree',
          worktreePath: path.resolve(otherWorktreePath),
        }),
      ],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
        {
          repoRoot: REPO_ROOT,
          branchName: 'feature/other-worktree',
          worktreePath: path.resolve(otherWorktreePath),
          tabs: [
            workspacePaneStaticTabEntry('history'),
            workspacePaneRuntimeTabEntry('terminal', 'term-otherworktreeotherwo1'),
          ],
        },
      ],
    })
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('preserves live terminal tabs after list canonicalization and later reorder operations', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
            workspacePaneStaticTabEntry('status'),
            workspacePaneStaticTabEntry('history'),
          ],
        },
      ],
    })

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'reorder', tabIdentities: ['workspace-pane:history', 'workspace-pane:status'] },
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            workspacePaneStaticTabEntry('history'),
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('listWorkspaceTabs projects terminal tabs from fresh worktree-scoped session state', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('listWorkspaceTabs materializes tabs for worktrees discovered before projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('reconcileTerminalTabsForSession returns canonical tabs without unrelated stale terminal tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-closedclosedclosed001'),
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(
      service.reconcileTerminalTabsForSession(USER_ID, terminalSession('term-closedclosedclosed001')),
    ).resolves.toBeUndefined()
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([
      workspacePaneRuntimeTabEntry('terminal', 'term-closedclosedclosed001'),
      workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
    ])
  })

  test('reconcileTerminalTabsForSession keeps the closed session id when it is still live', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(
      service.reconcileTerminalTabsForSession(USER_ID, terminalSession('term-livelivelivelivelive1')),
    ).resolves.toBeUndefined()
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
    ])
  })

  test('serializes terminal tab reconciliation with later workspace tab reorder operations', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-closedclosedclosed001'),
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

    const close = service.reconcileTerminalTabsForSession(USER_ID, terminalSession('term-closedclosedclosed001'))
    await vi.waitFor(() => expect(listSessionResolves).toHaveLength(1))

    const reorder = service.updateTabs(USER_ID, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      operation: { type: 'reorder', tabIdentities: ['workspace-pane:history', 'workspace-pane:status'] },
    })

    expect(listSessionResolves).toHaveLength(1)
    listSessionResolves[0]!([])
    await expect(close).resolves.toBeUndefined()
    await vi.waitFor(() => expect(listSessionResolves).toHaveLength(2))
    listSessionResolves[1]!([])

    await expect(reorder).resolves.toMatchObject({
      entries: [
        {
          tabs: [workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('status')],
        },
      ],
    })
    expect(
      workspaceTabs.tabs({
        userId: USER_ID,
        scope: RUNTIME_SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: path.resolve(WORKTREE_PATH),
      }),
    ).toEqual([
      workspacePaneStaticTabEntry('history'),
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-closedclosedclosed001'),
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
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          workspacePaneStaticTabEntry('files'),
        ],
      }),
    ).resolves.toMatchObject({ entries: [{ tabs: [workspacePaneStaticTabEntry('status')] }] })

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
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        workspacePaneStaticTabEntry('history'),
        workspacePaneStaticTabEntry('status'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'close-static', tabType: 'history' },
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
            workspacePaneStaticTabEntry('status'),
          ],
        },
      ],
    })

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: {
          type: 'reorder',
          tabIdentities: ['workspace-pane:history', 'workspace-pane:status', 'terminal:term-livelivelivelivelive1'],
        },
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('updateTabs retargets worktree tabs when the worktree branch changes', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/old',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        workspacePaneStaticTabEntry('status'),
      ],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
    })

    await expect(
      service.updateTabs(USER_ID, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: 'feature/new',
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
            workspacePaneStaticTabEntry('status'),
            workspacePaneStaticTabEntry('history'),
          ],
        },
      ],
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'feature/new',
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
            workspacePaneStaticTabEntry('status'),
            workspacePaneStaticTabEntry('history'),
          ],
        },
      ],
    })
  })

  test('listWorkspaceTabs materializes missing terminal tabs without reverting current worktree branch', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: 'feature/new',
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1', { branch: 'feature/old' })],
      workspaceTabs,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'feature/new',
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
  })

  test('listWorkspaceTabs materializes missing terminal tabs from live sessions', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
          ],
        },
      ],
    })
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('listWorkspaceTabs does not materialize terminal tabs after repo runtime goes stale during projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let current = true
    let currentChecks = 0
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [terminalSession('term-livelivelivelivelive1')],
      workspaceTabs,
      isCurrentRepoRuntime: () => {
        currentChecks += 1
        if (currentChecks === 2) current = false
        return current
      },
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).rejects.toThrow(
      'error.repo-runtime-stale',
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
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: REMOTE_RUNTIME_SCOPE,
      branchName: REMOTE_BRANCH_NAME,
      worktreePath: REMOTE_WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [
        terminalSession('term-remoteremoteremote001', {
          repoRoot: REMOTE_REPO_ROOT,
          repoRuntimeId: REMOTE_REPO_RUNTIME_ID,
          branch: REMOTE_BRANCH_NAME,
          worktreePath: REMOTE_WORKTREE_PATH,
        }),
      ],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REMOTE_REPO_ROOT, REMOTE_REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REMOTE_REPO_ROOT,
          branchName: REMOTE_BRANCH_NAME,
          worktreePath: REMOTE_WORKTREE_PATH,
          tabs: [
            workspacePaneStaticTabEntry('status'),
            workspacePaneRuntimeTabEntry('terminal', 'term-remoteremoteremote001'),
          ],
        },
      ],
    })
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })

  test('listWorkspaceTabs prunes stale terminal tabs from the canonical projection', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: RUNTIME_SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: path.resolve(WORKTREE_PATH),
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
        workspacePaneStaticTabEntry('status'),
      ],
    })
    const broadcastWorkspaceTabsChanged = vi.fn()
    const service = createService({
      sessions: [],
      workspaceTabs,
      broadcastWorkspaceTabsChanged,
    })

    await expect(service.listWorkspaceTabs(USER_ID, REPO_ROOT, REPO_RUNTIME_ID)).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: path.resolve(WORKTREE_PATH),
          tabs: [workspacePaneStaticTabEntry('status')],
        },
      ],
    })
    expect(broadcastWorkspaceTabsChanged).not.toHaveBeenCalled()
  })
})

function createService(options: {
  sessions: TerminalSessionSummary[] | (() => TerminalSessionSummary[] | Promise<TerminalSessionSummary[]>)
  workspaceTabs: WorkspacePaneTabsRuntime<string>
  ensureSession?: (input: EnsureSessionInput) => Promise<TerminalSessionEnsureAttachResult>
  closeSession?: (terminalRuntimeSessionId: string) => Promise<boolean>
  isCurrentRepoRuntime?: (userId: string, repoRoot: string, repoRuntimeId: string) => boolean
  broadcastWorkspaceTabsChanged?: (userId: string, repoRoot: string) => void
}) {
  const manager = {
    ensureSession:
      options.ensureSession ??
      (async () => ({
        ok: false as const,
        message: 'unused',
      })),
    listSessionsForUser: vi.fn(
      async () => await (typeof options.sessions === 'function' ? options.sessions() : options.sessions),
    ),
    terminalSessionsSnapshotForUser: vi.fn(() => ({ revision: 7, sessions: [] })),
    closeSession: options.closeSession ?? vi.fn(async () => false),
  }
  const workspaceTabsCoordinator = createWorkspacePaneTabsCoordinator({
    workspaceTabs: options.workspaceTabs,
    worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
    runtimeProviders: [terminalWorkspacePaneRuntimeTabsProvider(manager)],
    physicalWorktrees: testPhysicalWorktrees,
  })
  return createTerminalSessionService({
    isValidClientId: (value): value is string => typeof value === 'string',
    isValidTerminalSessionId: (value): value is string => typeof value === 'string' && value.length > 0,
    manager,
    workspaceTabsCoordinator,
    isCurrentRepoRuntime: options.isCurrentRepoRuntime ?? (() => true),
    broadcastSessionsChanged: vi.fn(),
    broadcastWorkspaceTabsChanged: options.broadcastWorkspaceTabsChanged ?? vi.fn(),
  })
}

function createTerminal(
  service: ReturnType<typeof createTerminalSessionService>,
  clientId: string,
  userId: string,
  input: TerminalCreateInput,
) {
  return service.createAdmitted(
    clientId,
    userId,
    input,
    testPhysicalWorktreeCapability(input.worktreePath),
    new AbortController().signal,
  )
}

function ensureOrRestore(
  service: ReturnType<typeof createTerminalSessionService>,
  clientId: string,
  userId: string,
  input: Parameters<ReturnType<typeof createTerminalSessionService>['ensureOrRestore']>[2],
) {
  return service.ensureOrRestore(
    clientId,
    userId,
    input,
    testPhysicalWorktreeCapability(input.worktreePath),
    new AbortController().signal,
  )
}

interface EnsureSessionInput {
  terminalSessionId: string
  cols: number
  rows: number
}

function terminalSession(
  terminalSessionId: string,
  overrides: Partial<Pick<TerminalSessionSummary, 'repoRoot' | 'repoRuntimeId' | 'branch' | 'worktreePath'>> = {},
): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
        terminalRuntimeGeneration: 1,
    terminalSessionId,
    repoRuntimeId: overrides.repoRuntimeId ?? REPO_RUNTIME_ID,
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

function terminalAttachResult(
  input: EnsureSessionInput,
): Extract<TerminalSessionEnsureAttachResult, { ok: true }> {
  return {
    ok: true,
    terminalSessionsRevision: 1,
    terminalRuntimeSessionId: 'pty_session_created',
        terminalRuntimeGeneration: 1,
    snapshot: '',
    snapshotSeq: 0,
    outputEra: 0,

    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: null,
    canonicalCols: input.cols,
    canonicalRows: input.rows,
  }
}
