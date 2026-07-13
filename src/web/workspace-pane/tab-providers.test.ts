import { describe, expect, test, vi } from 'vitest'
import {
  changesWorkspacePaneTabProvider,
  filesWorkspacePaneTabProvider,
  historyWorkspacePaneTabProvider,
  isWorkspacePaneRuntimeTabProvider,
  statusWorkspacePaneTabProvider,
  terminalWorkspacePaneTabProvider,
  workspacePaneRuntimeTabProvider,
  workspacePaneRuntimeTabProviders,
  workspacePaneStaticTabProvider,
  workspacePaneTabProviders,
  workspacePaneTabProvider,
} from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  WORKSPACE_PANE_BRANCH_TAB_TYPES,
  WORKSPACE_PANE_STATIC_TAB_IDS,
  WORKSPACE_PANE_STATIC_TAB_TYPES,
  WORKSPACE_PANE_TAB_TYPES,
  WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  workspacePaneStaticTabEntry,
  workspacePaneStaticTabScope,
  workspacePaneTabScope,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key)

function renderability(input: {
  sessionCount?: number
  createPending?: boolean
  projectionPhase?: WorkspacePaneRuntimeProjectionPhase
}) {
  return {
    hasWorktree: true,
    runtimeTabAvailabilityByType: {
      terminal: {
        sessionCount: input.sessionCount ?? 0,
        createPending: input.createPending ?? false,
        projectionPhase: input.projectionPhase ?? 'ready',
      },
    },
  }
}

const terminalView: WorkspacePaneTabSummary = {
  type: 'terminal',
  terminalSessionId: 'term-111111111111111111111',
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
  test('centralizes static tab scope', () => {
    expect(statusWorkspacePaneTabProvider.scope).toBe('branch')
    expect(changesWorkspacePaneTabProvider.scope).toBe('worktree')
    expect(historyWorkspacePaneTabProvider.scope).toBe('branch')
    expect(filesWorkspacePaneTabProvider.scope).toBe('worktree')
  })

  test('derives provider scope from the shared workspace pane scope definitions', () => {
    for (const provider of workspacePaneTabProviders) {
      expect(provider.scope).toBe(workspacePaneTabScope(provider.type))
    }
  })

  test('registers one provider per workspace pane tab type', () => {
    expect(workspacePaneTabProviders.map((provider) => provider.type)).toEqual([...WORKSPACE_PANE_TAB_TYPES])
  })

  test('registers runtime tab providers separately from static providers', () => {
    expect(workspacePaneRuntimeTabProviders().map((provider) => provider.type)).toEqual(['terminal'])
    expect(workspacePaneRuntimeTabProvider('terminal')).toBe(terminalWorkspacePaneTabProvider)
    expect(isWorkspacePaneRuntimeTabProvider(workspacePaneTabProvider('terminal'))).toBe(true)
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
      terminalWorkspacePaneTabProvider.isRenderable(renderability({ projectionPhase: 'pending', sessionCount: 0 })),
    ).toBe(true)
    expect(
      terminalWorkspacePaneTabProvider.isRenderable(renderability({ projectionPhase: 'ready', createPending: true })),
    ).toBe(true)
    expect(
      terminalWorkspacePaneTabProvider.isRenderable(renderability({ projectionPhase: 'ready', sessionCount: 0 })),
    ).toBe(false)
    expect(
      terminalWorkspacePaneTabProvider.isRenderable(renderability({ projectionPhase: 'ready', sessionCount: 1 })),
    ).toBe(true)
  })

  test('labels terminal pending state by projection phase', () => {
    expect(
      terminalWorkspacePaneTabProvider.pendingLabel({
        t,
        createPending: false,
        projectionPhase: 'pending',
      }),
    ).toBe('terminal.loading')
    expect(
      terminalWorkspacePaneTabProvider.pendingLabel({
        t,
        createPending: false,
        projectionPhase: 'failed',
      }),
    ).toBe('terminal.load-failed')
    expect(
      terminalWorkspacePaneTabProvider.pendingLabel({
        t,
        createPending: true,
        projectionPhase: 'failed',
      }),
    ).toBe('terminal.load-failed')
  })

  test('exposes terminal bell state as runtime tab attention metadata', () => {
    expect(terminalWorkspacePaneTabProvider.attention({ view: terminalView })).toEqual({ attention: false })
    expect(terminalWorkspacePaneTabProvider.attention({ view: { ...terminalView, hasBell: true } })).toEqual({
      attention: true,
      attentionLabelKey: 'terminal.bell-unread',
    })
  })

  test('builds stable identities, tab entries, and labels', () => {
    expect(workspacePaneStaticTabProvider('status').identity()).toBe(WORKSPACE_PANE_STATIC_TAB_IDS.status)
    expect(workspacePaneStaticTabProvider('status').buttonId('workspace-pane')).toBe('workspace-pane-status-tab')
    expect(workspacePaneStaticTabProvider('status').panelId('workspace-pane')).toBe('workspace-pane-status-panel')
    expect(workspacePaneStaticTabProvider('changes').tabEntry()).toEqual(workspacePaneStaticTabEntry('changes'))
    expect(terminalWorkspacePaneTabProvider.identity('term-111111111111111111111')).toBe('terminal:term-111111111111111111111')
    expect(terminalWorkspacePaneTabProvider.buttonId('workspace-pane', 0)).toBe('workspace-pane-workspace-pane-tab')
    expect(terminalWorkspacePaneTabProvider.buttonId('workspace-pane', 2)).toBe('workspace-pane-workspace-pane-tab-2')
    expect(terminalWorkspacePaneTabProvider.tabEntry('term-111111111111111111111')).toEqual(workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'))
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

  test('runtime provider close is delegated to runtime close actions', async () => {
    await expect(
      terminalWorkspacePaneTabProvider.close({
        repoId: '/repo',
        branchName: 'main',
        runtimeSessionId: 'term-111111111111111111111',
      }),
    ).resolves.toBe(false)
  })
})
