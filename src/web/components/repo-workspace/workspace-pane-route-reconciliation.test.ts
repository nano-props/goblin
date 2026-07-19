import { describe, expect, test } from 'vitest'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  createRepoWorkspaceTabModel as createRepoWorkspaceTabModelCore,
  type RepoWorkspaceTabModelInput,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
} from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-route-reconciliation-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/tmp/goblin-route-reconciliation-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

type RouteModelInput = Omit<RepoWorkspaceTabModelInput, 'paneTarget' | 'worktreeHead'> & {
  branchName: string | null
  worktreePath: string | null
}

function createRepoWorkspaceTabModel(input: RouteModelInput) {
  const { branchName, worktreePath, ...modelInput } = input
  return createRepoWorkspaceTabModelCore({
    ...modelInput,
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
    const model = createRepoWorkspaceTabModel({
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
    const model = createRepoWorkspaceTabModel({
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
      kind: 'replace-empty-pane',
    })
  })

  test('waits for tab entries before replacing a missing routed static tab', () => {
    const model = createRepoWorkspaceTabModel({
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
    const model = createRepoWorkspaceTabModel({
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
    const model = createRepoWorkspaceTabModel({
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
    const model = createRepoWorkspaceTabModel({
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

  test('replaces an unmaterialized static route with the bare branch route', () => {
    const model = createRepoWorkspaceTabModel({
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
      kind: 'replace-empty-pane',
    })
  })

  test('replaces an invalid static route with the bare branch route', () => {
    const model = createRepoWorkspaceTabModel({
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
      kind: 'replace-empty-pane',
    })
  })

  test('leaves an invalid static route unverified while tab-entry projection has failed', () => {
    const model = createRepoWorkspaceTabModel({
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
    const model = createRepoWorkspaceTabModel({
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
      kind: 'replace-empty-pane',
    })
  })
})

function terminalModel(input: {
  routedSessionId: string
  terminalProjectionPhase: 'pending' | 'ready' | 'failed'
  createPending?: boolean
}) {
  return createRepoWorkspaceTabModel({
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
    terminalWorktreeKey: WORKTREE_KEY,
    index: 1,
    title: terminalSessionId,
    phase: 'open',
    selected: false,
    hasBell: false,
    hasRecentOutput: false,
  }
}
