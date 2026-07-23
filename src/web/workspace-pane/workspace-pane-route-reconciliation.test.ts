import { describe, expect, test } from 'vitest'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  createWorkspacePaneTabModel as createWorkspacePaneTabModelCore,
  type WorkspacePaneTabModelInput,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  reconcileWorkspacePaneRoute,
  resolveFilesystemWorkspacePaneReplacement,
  workspacePaneRouteHistoryResolution,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-route-reconciliation-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/tmp/goblin-route-reconciliation-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

type RouteModelInput = Omit<WorkspacePaneTabModelInput, 'routeTarget' | 'paneTarget' | 'worktreeHead'> & {
  branchName: string | null
  worktreePath: string | null
}

function createWorkspacePaneTabModel(input: RouteModelInput) {
  const { branchName, worktreePath, ...modelInput } = input
  return createWorkspacePaneTabModelCore({
    ...modelInput,
    routeTarget: branchName
      ? { kind: 'git-branch', workspaceId: input.workspaceId, branchName }
      : worktreePath === input.workspaceId
        ? { kind: 'workspace-root', workspaceId: input.workspaceId }
        : { kind: 'inactive', workspaceId: input.workspaceId },
    paneTarget: branchName
      ? requiredGitWorkspacePaneTabsTarget(input.workspaceId, branchName, worktreePath)
      : worktreePath === input.workspaceId
        ? { kind: 'workspace-root', workspaceId: input.workspaceId }
        : { kind: 'inactive', workspaceId: input.workspaceId },
    worktreeHead: branchName && worktreePath ? { kind: 'branch', branchName } : undefined,
  })
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

  test('waits for terminal projection before replacing a missing routed terminal session', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'pending' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'pending',
    })
  })

  test('waits for tab entries before replacing a routed terminal session', () => {
    const model = createWorkspacePaneTabModel({
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
    const model = createWorkspacePaneTabModel({
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

  test('waits for terminal creation before replacing a missing routed terminal session', () => {
    const model = terminalModel({
      routedSessionId: 'missing-session',
      terminalProjectionPhase: 'ready',
      createPending: true,
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'pending',
    })
  })

  test('replaces a stale terminal route with the bare branch route', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'ready' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'missing',
    })
  })

  test('waits for tab entries before replacing a missing routed static tab', () => {
    const model = createWorkspacePaneTabModel({
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
    const model = createWorkspacePaneTabModel({
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

  test('does not verify a materialized static route while tab-entry projection has failed', () => {
    const model = createWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabEntries: [workspacePaneStaticTabEntry('history')],
      tabEntriesProjectionPhase: 'failed',
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready' },
      },
    })

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'history' }, model)).toEqual({ kind: 'unverified' })
  })

  test('defers history while a route is unverified', () => {
    expect(workspacePaneRouteHistoryResolution({ kind: 'static', tab: 'history' }, { kind: 'unverified' })).toEqual({
      kind: 'defer',
    })
  })

  test('waits for terminal creation before replacing a missing routed static tab', () => {
    const model = createWorkspacePaneTabModel({
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

  test('waits for runtime projection before choosing a replacement for a missing static route', () => {
    const model = replacementTerminalModel('pending')

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'files' }, model)).toEqual({ kind: 'missing' })
    expect(resolveFilesystemWorkspacePaneReplacement(model)).toEqual({ kind: 'pending' })
  })

  test('chooses the authoritative selected terminal after replacement projection is complete', () => {
    const model = replacementTerminalModel('ready')

    expect(reconcileWorkspacePaneRoute({ kind: 'static', tab: 'files' }, model)).toEqual({ kind: 'missing' })
    expect(resolveFilesystemWorkspacePaneReplacement(model)).toMatchObject({
      kind: 'resolved',
      replacement: {
        kind: 'runtime',
        runtimeType: 'terminal',
        sessionId: 'term-111111111111111111111',
      },
    })
  })

  test('chooses an earlier static entry without waiting for an unrelated runtime projection', () => {
    const model = createWorkspacePaneTabModel({
      workspaceId: REPO_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: null,
      tabEntries: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      ],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: { terminal: { projectionPhase: 'pending', selectedSessionId: null } },
    })

    expect(resolveFilesystemWorkspacePaneReplacement(model)).toMatchObject({
      kind: 'resolved',
      replacement: { kind: 'static', type: 'status' },
    })
  })

  test('keeps a selected runtime replacement unverified when its projection failed', () => {
    const model = replacementTerminalModel('failed')

    expect(resolveFilesystemWorkspacePaneReplacement(model)).toEqual({ kind: 'unverified' })
  })

  test('resolves a missing filesystem route to the bare pane when no tab remains', () => {
    const model = createWorkspacePaneTabModel({
      workspaceId: REPO_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: WORKTREE_PATH,
      preferredTab: null,
      tabEntries: [],
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: [],
      runtimeTabStateByType: { terminal: { projectionPhase: 'ready' } },
    })

    expect(resolveFilesystemWorkspacePaneReplacement(model)).toEqual({ kind: 'resolved', replacement: null })
  })

  test('replaces an unmaterialized static route with the bare branch route', () => {
    const model = createWorkspacePaneTabModel({
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

  test('replaces an invalid static route with the bare branch route', () => {
    const model = createWorkspacePaneTabModel({
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
    const model = createWorkspacePaneTabModel({
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

  test('replaces an unmaterialized route with the bare branch route when the pane is empty', () => {
    const model = createWorkspacePaneTabModel({
      workspaceId: REPO_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/route',
      worktreePath: null,
      preferredTab: 'changes',
      tabEntries: [],
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
})

function terminalModel(input: {
  routedSessionId: string
  terminalProjectionPhase: 'pending' | 'ready' | 'failed'
  createPending?: boolean
}) {
  return createWorkspacePaneTabModel({
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

function replacementTerminalModel(terminalProjectionPhase: 'pending' | 'ready' | 'failed') {
  return createWorkspacePaneTabModel({
    workspaceId: REPO_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    branchName: 'feature/route',
    worktreePath: WORKTREE_PATH,
    preferredTab: null,
    tabEntries: [
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
    ],
    tabEntriesProjectionPhase: 'ready',
    runtimeTabViews: [terminalView('term-111111111111111111111')],
    runtimeTabStateByType: {
      terminal: {
        projectionPhase: terminalProjectionPhase,
        selectedSessionId: 'term-111111111111111111111',
      },
    },
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
