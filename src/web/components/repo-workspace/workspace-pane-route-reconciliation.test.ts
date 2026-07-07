import { describe, expect, test } from 'vitest'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { createRepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import { reconcileWorkspacePaneRoute } from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'

const REPO_ID = '/tmp/gbl-route-reconciliation-repo'
const WORKTREE_PATH = '/tmp/gbl-route-reconciliation-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

describe('workspace pane route reconciliation', () => {
  test('keeps a routed terminal session when it is materialized', () => {
    const model = terminalModel({ routedSessionId: 'session-1', terminalProjectionPhase: 'ready' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'session-1' }, model)).toEqual({
      kind: 'none',
    })
  })

  test('waits for terminal projection before replacing a missing routed terminal session', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'pending' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'pending',
    })
  })

  test('replaces a stale terminal route with the resolved materialized terminal tab', () => {
    const model = terminalModel({ routedSessionId: 'missing-session', terminalProjectionPhase: 'ready' })

    expect(reconcileWorkspacePaneRoute({ kind: 'terminal', terminalSessionId: 'missing-session' }, model)).toEqual({
      kind: 'replace',
      route: { kind: 'terminal', terminalSessionId: 'session-1' },
    })
  })

  test('waits for tab entries before replacing a missing routed static tab', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
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

  test('replaces an unmaterialized static route with the resolved materialized tab', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
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
      kind: 'replace',
      route: { kind: 'static', tab: 'status' },
    })
  })

  test('replaces an unmaterialized route with the bare branch route when the pane is empty', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
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
      kind: 'replace',
      route: null,
    })
  })
})

function terminalModel(input: { routedSessionId: string; terminalProjectionPhase: 'pending' | 'ready' | 'failed' }) {
  return createRepoWorkspaceTabModel({
    repoId: REPO_ID,
    branchName: 'feature/route',
    worktreePath: WORKTREE_PATH,
    preferredTab: 'terminal',
    tabEntries: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-1')],
    tabEntriesProjectionPhase: 'ready',
    runtimeTabViews: [terminalView('session-1')],
    runtimeTabStateByType: {
      terminal: {
        projectionPhase: input.terminalProjectionPhase,
        selectedSessionId: input.routedSessionId,
      },
    },
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
