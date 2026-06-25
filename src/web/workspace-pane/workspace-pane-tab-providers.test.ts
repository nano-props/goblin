import { describe, expect, test } from 'vitest'
import {
  changesWorkspacePaneTabProvider,
  historyWorkspacePaneTabProvider,
  statusWorkspacePaneTabProvider,
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  workspacePaneTabProviders,
  workspacePaneTabProvider,
} from '#/web/workspace-pane/workspace-pane-tab-providers.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import {
  WORKSPACE_PANE_BRANCH_VIEW_TYPES,
  WORKSPACE_PANE_STATIC_VIEW_TYPES,
  WORKSPACE_PANE_VIEW_TYPES,
  WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES,
  workspacePaneStaticViewScope,
  workspacePaneViewScope,
} from '#/shared/workspace-pane.ts'

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key

const terminalView: WorkspacePaneViewSummary = {
  type: 'terminal',
  id: 'slot-1',
  key: 'slot-1',
  worktreeTerminalKey: 'repo\0worktree',
  slotId: 'slot-1',
  index: 1,
  displayOrder: 1,
  title: 'Terminal 1',
  fullTitle: 'Terminal 1 full',
  originalTitle: null,
  phase: 'open',
  selected: true,
  hasBell: false,
}

describe('workspace pane tab providers', () => {
  test('centralizes static tab scope and refresh behavior', () => {
    expect(statusWorkspacePaneTabProvider.scope).toBe('branch')
    expect(statusWorkspacePaneTabProvider.refreshOnOpen).toBe(true)
    expect(changesWorkspacePaneTabProvider.scope).toBe('worktree')
    expect(changesWorkspacePaneTabProvider.refreshOnOpen).toBe(true)
    expect(historyWorkspacePaneTabProvider.scope).toBe('branch')
    expect(historyWorkspacePaneTabProvider.refreshOnOpen).toBe(false)
  })

  test('derives provider scope from the shared workspace pane scope definitions', () => {
    for (const provider of workspacePaneTabProviders) {
      expect(provider.scope).toBe(workspacePaneViewScope(provider.type))
    }
  })

  test('registers one provider per workspace pane view type', () => {
    expect(workspacePaneTabProviders.map((provider) => provider.type)).toEqual([...WORKSPACE_PANE_VIEW_TYPES])
  })

  test('derives shared static scope lists from the static scope map', () => {
    const branchViews = WORKSPACE_PANE_STATIC_VIEW_TYPES.filter((type) => workspacePaneStaticViewScope(type) === 'branch')
    const worktreeViews = WORKSPACE_PANE_STATIC_VIEW_TYPES.filter(
      (type) => workspacePaneStaticViewScope(type) === 'worktree',
    )

    expect(WORKSPACE_PANE_BRANCH_VIEW_TYPES).toEqual(branchViews)
    expect(WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES).toEqual(worktreeViews)
  })

  test('resolves worktree availability through providers', () => {
    expect(workspacePaneTabProvider('status').canOpen({ hasWorktree: false })).toBe(true)
    expect(workspacePaneTabProvider('history').canOpen({ hasWorktree: false })).toBe(true)
    expect(workspacePaneTabProvider('changes').canOpen({ hasWorktree: false })).toBe(false)
    expect(workspacePaneTabProvider('terminal').canOpen({ hasWorktree: false })).toBe(false)
  })

  test('keeps terminal renderability tied to sync and session truth', () => {
    expect(
      terminalWorkspacePaneTabProvider.isRenderable({
        hasWorktree: true,
        terminalSyncReady: false,
        terminalSessionCount: 0,
      }),
    ).toBe(true)
    expect(
      terminalWorkspacePaneTabProvider.isRenderable({
        hasWorktree: true,
        terminalSyncReady: true,
        terminalCreatePending: true,
        terminalSessionCount: 0,
      }),
    ).toBe(true)
    expect(
      terminalWorkspacePaneTabProvider.isRenderable({
        hasWorktree: true,
        terminalSyncReady: true,
        terminalSessionCount: 0,
      }),
    ).toBe(false)
    expect(
      terminalWorkspacePaneTabProvider.isRenderable({
        hasWorktree: true,
        terminalSyncReady: true,
        terminalSessionCount: 1,
      }),
    ).toBe(true)
  })

  test('builds stable identities, order entries, and labels', () => {
    expect(workspacePaneStaticTabProvider('status').identity()).toBe('status:status')
    expect(workspacePaneStaticTabProvider('status').buttonId('workspace-pane')).toBe('workspace-pane-status-tab')
    expect(workspacePaneStaticTabProvider('status').panelId('workspace-pane')).toBe('workspace-pane-status-panel')
    expect(workspacePaneStaticTabProvider('changes').orderEntry()).toEqual({ type: 'changes', id: 'changes' })
    expect(terminalWorkspacePaneTabProvider.identity('slot-1')).toBe('terminal:slot-1')
    expect(terminalWorkspacePaneTabProvider.buttonId('workspace-pane', 0)).toBe('workspace-pane-workspace-pane-view')
    expect(terminalWorkspacePaneTabProvider.buttonId('workspace-pane', 2)).toBe('workspace-pane-workspace-pane-view-2')
    expect(terminalWorkspacePaneTabProvider.orderEntry('slot-1')).toEqual({ type: 'terminal', id: 'slot-1' })
    expect(changesWorkspacePaneTabProvider.label({ t, branchName: 'main', statusCount: 3 })).toBe(
      'tab.changes-with-count:{"count":3}',
    )
    expect(changesWorkspacePaneTabProvider.closeLabel({ t, branchName: 'main', statusCount: 3 })).toBe(
      'workspace-pane-views.close-named:{"name":"tab.changes"}',
    )
    expect(changesWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 7 })).toBe(
      'workspace-pane-views.changes-tooltip:{"count":7}',
    )
    expect(statusWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0 })).toBe(
      'workspace-pane-views.status-tooltip:{"branch":"main"}',
    )
    expect(statusWorkspacePaneTabProvider.tooltip({ t, branchName: '', statusCount: 0 })).toBe('tab.status')
    expect(historyWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0 })).toBe(
      'workspace-pane-views.history-tooltip:{"branch":"main"}',
    )
    expect(terminalWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0, view: terminalView })).toBe(
      'Terminal 1 full',
    )
  })
})
