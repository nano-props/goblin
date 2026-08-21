import { describe, expect, test } from 'vitest'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  createWorkspacePaneTabModel,
  type WorkspacePaneTabModelInput,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  workspacePaneLocationForBranchTarget,
  workspacePaneLocationForLinkedWorktree,
  workspacePaneLocationForRoot,
} from '#/web/workspace-pane/workspace-pane-location.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-route-reconciliation-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/tmp/goblin-route-reconciliation-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

type RouteModelInput = Omit<Extract<WorkspacePaneTabModelInput, { location: null }>, 'location'> & {
  branchName: string | null
  worktreePath: string | null
}

function createBranchWorkspacePaneTabModel(input: RouteModelInput) {
  const { branchName, worktreePath, workspaceId, workspaceRuntimeId, ...modelInput } = input
  const location = branchName
    ? worktreePath
      ? workspacePaneLocationForLinkedWorktree(
          { kind: 'git-worktree', workspaceId, worktreePath },
          workspaceRuntimeId,
          { kind: 'branch', branchName },
        )
      : workspacePaneLocationForBranchTarget({ kind: 'git-branch', workspaceId, branchName }, workspaceRuntimeId)
    : worktreePath === workspaceId
      ? workspacePaneLocationForRoot(workspaceId, workspaceRuntimeId)
      : null
  return location
    ? createWorkspacePaneTabModel({ ...modelInput, location })
    : createWorkspacePaneTabModel({ ...modelInput, location: null, workspaceId, workspaceRuntimeId })
}

describe('workspace pane route reconciliation', () => {
  test('keeps a routed terminal session when it is materialized', () => {
    const model = terminalModel({ routedSessionId: 'term-111111111111111111111', terminalProjectionPhase: 'ready' })

    expect(
      reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }, model),
    ).toEqual({
      kind: 'none',
    })
  })

  test('waits for terminal projection before declaring a routed terminal session missing', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'pending' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'pending',
    })
  })

  test('waits for tab entries before validating a routed terminal session', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [],
      tabEntriesProjectionPhase: 'pending',
      runtimeTabViews: [terminalView('term-111111111111111111111')],
      runtimeTabStateByType: {
        terminal: {
          projectionPhase: 'ready',
          selectedSessionId: null,
        },
      },
      requestedSessionIdByRuntimeType: { terminal: 'term-111111111111111111111' },
    })

    expect(
      reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }, model),
    ).toEqual({
      kind: 'pending',
    })
  })

  test('does not verify a materialized terminal route while terminal projection is pending', () => {
    const model = terminalModel({ routedSessionId: 'term-111111111111111111111', terminalProjectionPhase: 'pending' })

    expect(
      reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }, model),
    ).toEqual({
      kind: 'pending',
    })
  })

  test('leaves a routed terminal session unverified while terminal projection has failed', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'failed' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'unverified',
    })
  })

  test('leaves a routed terminal session unverified while tab-entry projection has failed', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [],
      tabEntriesProjectionPhase: 'failed',
      runtimeTabViews: [terminalView('term-111111111111111111111')],
      runtimeTabStateByType: {
        terminal: {
          projectionPhase: 'ready',
          selectedSessionId: null,
        },
      },
      requestedSessionIdByRuntimeType: { terminal: 'term-111111111111111111111' },
    })

    expect(
      reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'term-111111111111111111111' }, model),
    ).toEqual({
      kind: 'unverified',
    })
  })

  test('waits for terminal creation before declaring a routed terminal session missing', () => {
    const model = terminalModel({
      routedSessionId: 'missing-session',
      terminalProjectionPhase: 'ready',
      createPending: true,
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'pending',
    })
  })

  test('reports a stale terminal route as missing', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'ready' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'missing',
    })
  })

  test('waits for a canonical terminal view to catch up to its tab entry', () => {
    const terminalSessionId = 'term-111111111111111111111'
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready', selectedSessionId: null },
      },
      requestedSessionIdByRuntimeType: { terminal: terminalSessionId },
    })

    expect(model.runtimeTabStateByType.terminal.projectionPhase).toBe('pending')
    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId }, model)).toEqual({ kind: 'pending' })
  })

  test('waits for tab entries before validating a routed static tab', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabEntries: [workspacePaneStaticTabEntry('status')],
      tabEntriesProjectionPhase: 'pending',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'history' }, model)).toEqual({ kind: 'pending' })
  })

  test('leaves a static route unverified while tab-entry projection has failed', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabEntries: [],
      tabEntriesProjectionPhase: 'failed',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'history' }, model)).toEqual({ kind: 'unverified' })
  })

  test.each(['pending', 'failed'] as const)(
    'defers a detached-worktree History route while tab entries are %s',
    (tabEntriesProjectionPhase) => {
      const model = createWorkspacePaneTabModel({
        location: workspacePaneLocationForLinkedWorktree(
          { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
          WORKSPACE_RUNTIME_ID,
          { kind: 'detached' },
        ),
        preferredTab: 'history',
        tabEntries: [workspacePaneStaticTabEntry('history')],
        tabEntriesProjectionPhase,
        runtimeTabViews: [],
        runtimeTabStateByType: { terminal: { projectionPhase: 'ready' } },
      })

      expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'history' }, model)).toEqual({
        kind: tabEntriesProjectionPhase === 'pending' ? 'pending' : 'unverified',
      })
    },
  )

  test('accepts a materialized Changes route for a detached worktree', () => {
    const model = createWorkspacePaneTabModel({
      location: workspacePaneLocationForLinkedWorktree(
        { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
        WORKSPACE_RUNTIME_ID,
        { kind: 'detached' },
      ),
      preferredTab: 'changes',
      tabEntries: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: { terminal: { projectionPhase: 'ready' } },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'changes' }, model)).toEqual({ kind: 'none' })
  })

  test.each(['unverified', 'missing'] as const)('defers history while a route is %s', (kind) => {
    expect(workspacePaneRouteHistoryResolution({ kind: 'static', tab: 'history' }, { kind })).toEqual({
      kind: 'defer',
    })
  })

  test('waits for terminal creation before declaring a routed static tab missing', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabEntries: [workspacePaneStaticTabEntry('status')],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { createPending: true, projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'history' }, model)).toEqual({ kind: 'pending' })
  })

  test('reports an unmaterialized static route as missing', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: null,
      preferredTab: 'changes',
      tabEntries: [workspacePaneStaticTabEntry('status')],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'changes' }, model)).toEqual({
      kind: 'missing',
    })
  })

  test('reports an invalid static route as missing', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: null,
      preferredTab: null,
      tabEntries: [workspacePaneStaticTabEntry('status')],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'invalid-static', tabKey: 'not-a-tab' }, model)).toEqual({
      kind: 'missing',
    })
  })

  test('leaves an invalid static route unverified while tab-entry projection has failed', () => {
    const model = createBranchWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: null,
      preferredTab: null,
      tabEntries: [workspacePaneStaticTabEntry('status')],
      tabEntriesProjectionPhase: 'failed',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'invalid-static', tabKey: 'not-a-tab' }, model)).toEqual({
      kind: 'unverified',
    })
  })
})

function terminalModel(input: {
  routedSessionId: string
  terminalProjectionPhase: 'pending' | 'ready' | 'failed'
  createPending?: boolean
}) {
  return createBranchWorkspacePaneTabModel({
    workspaceId: REPO_ID,

    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    branchName: 'feature/route',
    worktreePath: WORKTREE_PATH,
    preferredTab: 'terminal',
    tabEntries: [
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
    ],
    tabEntriesProjectionPhase: 'ready',
    runtimeTabViews: [terminalView('term-111111111111111111111')],
    runtimeTabStateByType: {
      terminal: {
        createPending: input.createPending ?? false,
        projectionPhase: input.terminalProjectionPhase,
        selectedSessionId: null,
      },
    },
    requestedSessionIdByRuntimeType: { terminal: input.routedSessionId },
  })
}

function terminalView(terminalSessionId: string): WorkspacePaneTabSummary {
  return {
    type: 'terminal',
    terminalSessionId,
    terminalFilesystemTargetKey: WORKTREE_KEY,
    index: 1,
    title: terminalSessionId,
    phase: 'open',
    selected: false,
    hasBell: false,
    hasRecentOutput: false,
  }
}
