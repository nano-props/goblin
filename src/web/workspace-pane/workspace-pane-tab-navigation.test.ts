import { describe, expect, test } from 'vitest'
import {
  adjacentWorkspacePaneTab,
  nextWorkspacePaneTabEntryAfterClose,
} from '#/web/workspace-pane/workspace-pane-tab-navigation.ts'
import {
  createModel,
  requiredEntryIdentity,
  staticEntry,
  terminalEntry,
  terminalView,
  WORKSPACE_ID,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_PATH,
} from '#/web/test-utils/workspace-pane-tab-model.ts'

describe('repo workspace pane tab navigation', () => {
  test('resolves the adjacent tab after close from the shared tab list', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabEntries: [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('changes')],
      runtimeTabViews: [terminalView('term-111111111111111111111', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-111111111111111111111',
    })

    expect(requiredEntryIdentity(nextWorkspacePaneTabEntryAfterClose(model.tabEntries, 'workspace-pane:status'))).toBe(
      'terminal:term-111111111111111111111',
    )
    expect(requiredEntryIdentity(nextWorkspacePaneTabEntryAfterClose(model.tabEntries, 'workspace-pane:changes'))).toBe(
      'terminal:term-111111111111111111111',
    )
    expect(nextWorkspacePaneTabEntryAfterClose(model.tabEntries, 'missing:missing')).toBeNull()
  })

  test('prefers the opener tab over the adjacent tab when resolving the next tab after close', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabEntries: [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('changes')],
      runtimeTabViews: [terminalView('term-111111111111111111111', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-111111111111111111111',
    })

    expect(
      requiredEntryIdentity(
        nextWorkspacePaneTabEntryAfterClose(
          model.tabEntries,
          'terminal:term-111111111111111111111',
          'workspace-pane:changes',
        ),
      ),
    ).toBe('workspace-pane:changes')
  })

  test('falls back to the adjacent tab when the opener tab no longer exists', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabEntries: [staticEntry('status'), terminalEntry('term-111111111111111111111'), staticEntry('changes')],
      runtimeTabViews: [terminalView('term-111111111111111111111', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-111111111111111111111',
    })

    expect(
      requiredEntryIdentity(
        nextWorkspacePaneTabEntryAfterClose(
          model.tabEntries,
          'terminal:term-111111111111111111111',
          'terminal:missing-opener',
        ),
      ),
    ).toBe('workspace-pane:changes')
  })

  test('skips pending terminal tabs when resolving the next tab after close', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalCreatePending: true,
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(nextWorkspacePaneTabEntryAfterClose(model.tabEntries, 'workspace-pane:status')).toBeNull()
  })

  test('moves through the shared tab list from the active tab identity', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [
        staticEntry('status'),
        terminalEntry('term-111111111111111111111'),
        terminalEntry('term-222222222222222222222'),
        staticEntry('changes'),
      ],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
    })

    expect(adjacentWorkspacePaneTab(model.tabs, model.activeTab?.identity, 1)?.identity).toBe('workspace-pane:changes')
    expect(adjacentWorkspacePaneTab(model.tabs, model.activeTab?.identity, -1)?.identity).toBe(
      'terminal:term-111111111111111111111',
    )
    expect(adjacentWorkspacePaneTab(model.tabs, null, -1)).toBeNull()
    expect(adjacentWorkspacePaneTab(model.tabs, 'missing:missing', 1)).toBeNull()
  })

  test('keeps the current terminal selection when another terminal remains selected', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [
        terminalEntry('term-111111111111111111111'),
        staticEntry('status'),
        terminalEntry('term-222222222222222222222'),
      ],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
    })

    expect(model.selection).toMatchObject({ kind: 'materialized-tab', tab: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:term-222222222222222222222')
  })
})
