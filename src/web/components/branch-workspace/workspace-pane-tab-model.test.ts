import { describe, expect, test } from 'vitest'
import {
  adjacentBranchWorkspacePaneTab,
  createBranchWorkspacePaneTabModel,
  nextBranchWorkspacePaneTabAfterClose,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'

const REPO_ID = '/tmp/gbl-workspace-pane-tab-model-repo'
const WORKTREE_PATH = '/tmp/gbl-workspace-pane-tab-model-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

describe('branch workspace pane tab model', () => {
  test('projects branch-owned tabs ahead of runtime worktree tabs', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'status',
      openBranchViews: ['status', 'history'],
      runtimeWorktreeViews: [terminalView('terminal-1', 1, true), changesView(2)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(model.worktreeTerminalKey).toBe(WORKTREE_KEY)
    expect(model.worktreeViews.map((view) => view.type)).toEqual(['terminal', 'changes'])
    expect(model.tabs.map((tab) => [tab.identity, tab.scope])).toEqual([
      ['status:status', 'branch'],
      ['history:history', 'branch'],
      ['terminal:terminal-1', 'worktree'],
      ['changes:changes', 'worktree'],
    ])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('uses the selected terminal as the active terminal tab', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      openBranchViews: ['status'],
      runtimeWorktreeViews: [terminalView('terminal-1', 1, false), terminalView('terminal-2', 2, true)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
    })

    expect(model.selectedView).toBe('terminal')
    expect(model.activeTab?.identity).toBe('terminal:terminal-2')
    expect(model.activeTab?.key).toBe('terminal-2')
  })

  test('keeps terminal selected without a runtime tab while creation is pending', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      openBranchViews: ['status'],
      runtimeWorktreeViews: [],
      terminalSessionCount: 0,
      pendingCreate: true,
      terminalSyncReady: true,
    })

    expect(model.selectedView).toBe('terminal')
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => tab.identity)).toEqual(['status:status'])
  })

  test('does not select another tab when the preferred worktree static view is not open', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'changes',
      openBranchViews: ['status'],
      runtimeWorktreeViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
    })

    expect(model.selectedView).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('does not select another tab when a branch preference names a closed tab', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'history',
      openBranchViews: ['status'],
      runtimeWorktreeViews: [terminalView('terminal-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(model.selectedView).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('returns branch-scope tabs when the selected branch has no worktree', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: null,
      preferredView: 'status',
      openBranchViews: ['status'],
      runtimeWorktreeViews: [terminalView('ignored', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
    })

    expect(model.worktreeViews).toEqual([])
    expect(model.tabs).toMatchObject([{ identity: 'status:status', scope: 'branch', type: 'status' }])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('resolves the adjacent tab after close from the shared tab list', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'status',
      openBranchViews: ['status'],
      runtimeWorktreeViews: [terminalView('terminal-1', 1, true), changesView(2)],
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
      openBranchViews: ['status'],
      runtimeWorktreeViews: [terminalView('terminal-1', 1, false), terminalView('terminal-2', 2, true), changesView(3)],
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

function changesView(displayOrder: number): WorkspacePaneViewSummary {
  return {
    type: 'changes',
    id: 'changes',
    key: 'changes',
    worktreeTerminalKey: WORKTREE_KEY,
    worktreePath: WORKTREE_PATH,
    displayOrder,
  }
}
