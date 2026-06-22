import { describe, expect, test } from 'vitest'
import {
  adjacentBranchWorkspacePaneTab,
  createBranchWorkspacePaneTabModel,
  nextBranchWorkspacePaneTabAfterClose,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'

const REPO_ID = '/tmp/gbl-workspace-pane-tab-model-repo'
const WORKTREE_PATH = '/tmp/gbl-workspace-pane-tab-model-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

describe('branch workspace pane tab model', () => {
  test('projects a single tab order across static and terminal tabs', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'status',
      tabOrder: [
        terminalEntry('terminal-1'),
        staticEntry('status'),
        staticEntry('changes'),
        staticEntry('history'),
      ],
      runtimeTerminalViews: [terminalView('terminal-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(model.worktreeTerminalKey).toBe(WORKTREE_KEY)
    expect(model.terminalViews.map((view) => view.type)).toEqual(['terminal'])
    expect(model.staticViews).toEqual(['status', 'changes', 'history'])
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['terminal:terminal-1', 'terminal'],
      ['status:status', 'static'],
      ['changes:changes', 'static'],
      ['history:history', 'static'],
    ])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('uses the selected terminal as the active terminal tab', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [terminalView('terminal-1', 1, false), terminalView('terminal-2', 2, true)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
    })

    expect(model.renderedView).toBe('terminal')
    expect(model.selection).toMatchObject({ kind: 'materialized-tab', view: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:terminal-2')
    expect(model.activeTab?.key).toBe('terminal-2')
  })

  test('keeps terminal selected without a runtime tab while creation is pending', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: true,
      terminalSyncReady: true,
    })

    expect(model.renderedView).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', view: 'terminal', tab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => tab.identity)).toEqual(['status:status'])
  })

  test('does not select another tab when the preferred worktree static view is not open', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'changes',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
    })

    expect(model.selection).toBeNull()
    expect(model.renderedView).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('does not select another tab when a branch preference names a closed tab', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'history',
      tabOrder: [staticEntry('status'), terminalEntry('terminal-1')],
      runtimeTerminalViews: [terminalView('terminal-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(model.selection).toBeNull()
    expect(model.renderedView).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('returns branch-scope tabs when the selected branch has no worktree', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: null,
      preferredView: 'status',
      tabOrder: [staticEntry('status'), staticEntry('changes'), terminalEntry('ignored')],
      runtimeTerminalViews: [terminalView('ignored', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(model.terminalViews).toEqual([])
    expect(model.tabs).toMatchObject([{ identity: 'status:status', kind: 'static', type: 'status' }])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('resolves the adjacent tab after close from the shared tab list', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'status',
      tabOrder: [staticEntry('status'), terminalEntry('terminal-1'), staticEntry('changes')],
      runtimeTerminalViews: [terminalView('terminal-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'status:status')?.identity).toBe('terminal:terminal-1')
    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'changes:changes')?.identity).toBe('terminal:terminal-1')
    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'missing:missing')).toBeNull()
  })

  test('moves through the shared tab list from the active tab identity', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [
        staticEntry('status'),
        terminalEntry('terminal-1'),
        terminalEntry('terminal-2'),
        staticEntry('changes'),
      ],
      runtimeTerminalViews: [terminalView('terminal-1', 1, false), terminalView('terminal-2', 2, true)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
    })

    expect(adjacentBranchWorkspacePaneTab(model.tabs, model.activeTab?.identity, 1)?.identity).toBe('changes:changes')
    expect(adjacentBranchWorkspacePaneTab(model.tabs, model.activeTab?.identity, -1)?.identity).toBe(
      'terminal:terminal-1',
    )
    expect(adjacentBranchWorkspacePaneTab(model.tabs, null, -1)).toBeNull()
    expect(adjacentBranchWorkspacePaneTab(model.tabs, 'missing:missing', 1)).toBeNull()
  })
})

function staticEntry(type: WorkspacePaneStaticViewType): WorkspacePaneTabOrderEntry {
  return { type, id: type }
}

function terminalEntry(id: string): WorkspacePaneTabOrderEntry {
  return { type: 'terminal', id }
}

function terminalView(key: string, displayOrder: number, selected: boolean): WorkspacePaneViewSummary {
  return {
    type: 'terminal',
    id: key,
    key,
    worktreeTerminalKey: WORKTREE_KEY,
    terminalId: key,
    index: displayOrder,
    displayOrder,
    title: key,
    phase: 'open',
    selected,
    hasBell: false,
  }
}
