import { describe, expect, test, vi } from 'vitest'
import {
  changesWorkspacePaneTabProvider,
  filesWorkspacePaneTabProvider,
  historyWorkspacePaneTabProvider,
  statusWorkspacePaneTabProvider,
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  workspacePaneTabProviders,
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import {
  WORKSPACE_PANE_BRANCH_TAB_TYPES,
  WORKSPACE_PANE_STATIC_TAB_IDS,
  WORKSPACE_PANE_STATIC_TAB_TYPES,
  WORKSPACE_PANE_TAB_TYPES,
  WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  workspacePaneStaticTabEntry,
  workspacePaneStaticTabScope,
  workspacePaneTabScope,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key)

const terminalView: WorkspacePaneTabSummary = {
  type: 'terminal',
  terminalSessionId: 'session-1',
  terminalWorktreeKey: 'repo\0worktree',
  index: 1,
  title: 'Terminal 1',
  fullTitle: 'Terminal 1 full',
  originalTitle: null,
  phase: 'open',
  selected: true,
  hasBell: false,
  hasRecentOutput: false,
}

describe('workspace pane tab providers', () => {
  test('centralizes static tab scope and refresh behavior', () => {
    expect(statusWorkspacePaneTabProvider.scope).toBe('branch')
    expect(statusWorkspacePaneTabProvider.refreshOnOpen).toBe(true)
    expect(changesWorkspacePaneTabProvider.scope).toBe('worktree')
    expect(changesWorkspacePaneTabProvider.refreshOnOpen).toBe(true)
    expect(historyWorkspacePaneTabProvider.scope).toBe('branch')
    expect(historyWorkspacePaneTabProvider.refreshOnOpen).toBe(false)
    expect(filesWorkspacePaneTabProvider.scope).toBe('worktree')
    expect(filesWorkspacePaneTabProvider.refreshOnOpen).toBe(true)
  })

  test('derives provider scope from the shared workspace pane scope definitions', () => {
    for (const provider of workspacePaneTabProviders) {
      expect(provider.scope).toBe(workspacePaneTabScope(provider.type))
    }
  })

  test('registers one provider per workspace pane tab type', () => {
    expect(workspacePaneTabProviders.map((provider) => provider.type)).toEqual([...WORKSPACE_PANE_TAB_TYPES])
  })

  test('derives shared static scope lists from the static scope map', () => {
    const branchTabs = WORKSPACE_PANE_STATIC_TAB_TYPES.filter((type) => workspacePaneStaticTabScope(type) === 'branch')
    const worktreeTabs = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
      (type) => workspacePaneStaticTabScope(type) === 'worktree',
    )

    expect(WORKSPACE_PANE_BRANCH_TAB_TYPES).toEqual(branchTabs)
    expect(WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES).toEqual(worktreeTabs)
  })

  test('resolves worktree availability through providers', () => {
    expect(workspacePaneTabProvider('status').canOpen({ hasWorktree: false })).toBe(true)
    expect(workspacePaneTabProvider('history').canOpen({ hasWorktree: false })).toBe(true)
    expect(workspacePaneTabProvider('changes').canOpen({ hasWorktree: false })).toBe(false)
    expect(workspacePaneTabProvider('files').canOpen({ hasWorktree: false })).toBe(false)
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

  test('builds stable identities, tab entries, and labels', () => {
    expect(workspacePaneStaticTabProvider('status').identity()).toBe(WORKSPACE_PANE_STATIC_TAB_IDS.status)
    expect(workspacePaneStaticTabProvider('status').buttonId('workspace-pane')).toBe('workspace-pane-status-tab')
    expect(workspacePaneStaticTabProvider('status').panelId('workspace-pane')).toBe('workspace-pane-status-panel')
    expect(workspacePaneStaticTabProvider('changes').tabEntry()).toEqual(workspacePaneStaticTabEntry('changes'))
    expect(terminalWorkspacePaneTabProvider.identity('session-1')).toBe('terminal:session-1')
    expect(terminalWorkspacePaneTabProvider.buttonId('workspace-pane', 0)).toBe('workspace-pane-workspace-pane-tab')
    expect(terminalWorkspacePaneTabProvider.buttonId('workspace-pane', 2)).toBe('workspace-pane-workspace-pane-tab-2')
    expect(terminalWorkspacePaneTabProvider.tabEntry('session-1')).toEqual(
      workspacePaneTerminalTabEntry('session-1'),
    )
    expect(changesWorkspacePaneTabProvider.label({ t, branchName: 'main', statusCount: 3 })).toBe(
      'tab.changes-with-count:{"count":3}',
    )
    expect(changesWorkspacePaneTabProvider.closeLabel({ t, branchName: 'main', statusCount: 3 })).toBe(
      'workspace-pane-tabs.close-named:{"name":"tab.changes"}',
    )
    expect(changesWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 7 })).toBe(
      'workspace-pane-tabs.changes-tooltip:{"count":7}',
    )
    expect(statusWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0 })).toBe(
      'workspace-pane-tabs.status-tooltip:{"branch":"main"}',
    )
    expect(statusWorkspacePaneTabProvider.tooltip({ t, branchName: '', statusCount: 0 })).toBe('tab.status')
    expect(historyWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0 })).toBe(
      'workspace-pane-tabs.history-tooltip:{"branch":"main"}',
    )
    expect(filesWorkspacePaneTabProvider.label({ t, branchName: 'main', statusCount: 0 })).toBe('tab.files')
    expect(filesWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0 })).toBe(
      'workspace-pane-tabs.files-tooltip:{"branch":"main"}',
    )
    expect(filesWorkspacePaneTabProvider.tooltip({ t, branchName: '', statusCount: 0 })).toBe('tab.files')
    expect(
      terminalWorkspacePaneTabProvider.tooltip({ t, branchName: 'main', statusCount: 0, view: terminalView }),
    ).toBe('Terminal 1 full')
  })

  test('keeps the internal terminal process placeholder out of runtime tab labels', () => {
    const placeholderTerminalView: WorkspacePaneTabSummary = {
      ...terminalView,
      title: 'terminal',
      fullTitle: 'terminal',
      originalTitle: null,
      phase: 'open',
    }

    const input = { t, branchName: 'main', statusCount: 0, view: placeholderTerminalView }

    expect(terminalWorkspacePaneTabProvider.label(input)).toBe('')
    expect(terminalWorkspacePaneTabProvider.tooltip(input)).toBe('terminal.opening')
    expect(terminalWorkspacePaneTabProvider.closeLabel(input)).toBe('terminal.close-named:{"name":"terminal.opening"}')
  })

  test('closes static tabs through the static tab lifecycle callback', async () => {
    const closeStaticTab = vi.fn()

    await expect(
      statusWorkspacePaneTabProvider.close({
        repoId: '/repo',
        branchName: 'main',
        closeStaticTab,
      }),
    ).resolves.toBe(true)

    expect(closeStaticTab).toHaveBeenCalledWith('/repo', 'status', 'main')
  })

  test('rejects static tab close without a branch owner', async () => {
    const closeStaticTab = vi.fn()

    await expect(
      statusWorkspacePaneTabProvider.close({
        repoId: '/repo',
        branchName: null,
        closeStaticTab,
      }),
    ).resolves.toBe(false)

    expect(closeStaticTab).not.toHaveBeenCalled()
  })

  test('closes terminal tabs through the terminal lifecycle callback', async () => {
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const terminalBase = { repoRoot: '/repo', branch: 'main', worktreePath: '/repo-worktree' }

    await expect(
      terminalWorkspacePaneTabProvider.close({
        repoId: '/repo',
        branchName: 'main',
        terminalSessionId: 'session-1',
        terminalBase,
        closeTerminalByDescriptor,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', terminalBase)
  })

  test('closes terminal worktree resources through the worktree lifecycle callback', async () => {
    const closeTerminalsForWorktree = vi.fn(async () => true)
    const terminalBase = { repoRoot: '/repo', branch: 'main', worktreePath: '/repo-worktree' }

    await expect(
      terminalWorkspacePaneTabProvider.closeWorktree({
        repoId: '/repo',
        branchName: 'main',
        terminalBase,
        closeTerminalsForWorktree,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalsForWorktree).toHaveBeenCalledWith(terminalBase)
  })
})
