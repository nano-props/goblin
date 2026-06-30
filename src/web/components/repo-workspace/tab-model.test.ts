import { describe, expect, test } from 'vitest'
import {
  adjacentRepoWorkspaceTab,
  createRepoWorkspaceTabModel,
  nextRepoWorkspaceTabAfterClose,
} from '#/web/components/repo-workspace/tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry, workspacePaneTerminalTabOrderEntry } from '#/shared/workspace-pane.ts'

const REPO_ID = '/tmp/gbl-repo-workspace-tab-model-repo'
const WORKTREE_PATH = '/tmp/gbl-repo-workspace-tab-model-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

describe('repo workspace pane tab model', () => {
  test('projects a single tab order across static and terminal tabs', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabOrder: [terminalEntry('session-1'), staticEntry('status'), staticEntry('changes'), staticEntry('history')],
      runtimeTerminalViews: [terminalView('session-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.worktreeTerminalKey).toBe(WORKTREE_KEY)
    expect(model.terminalViews.map((view) => view.type)).toEqual(['terminal'])
    expect(model.staticTabs).toEqual(['status', 'changes', 'history'])
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['terminal:session-1', 'terminal'],
      ['workspace-pane:status', 'static'],
      ['workspace-pane:changes', 'static'],
      ['workspace-pane:history', 'static'],
    ])
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('uses the selected terminal from the store as the active terminal tab', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [terminalView('session-1', 1, false), terminalView('session-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-2',
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toMatchObject({ kind: 'materialized-tab', tab: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:session-2')
    expect(model.activeTab?.kind === 'terminal' ? model.activeTab.terminalKey : null).toBe('session-2')
  })

  test('keeps runtime-only terminals before a newly recorded terminal that follows them', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status'), terminalEntry('session-2')],
      runtimeTerminalViews: [terminalView('session-1', 1, false), terminalView('session-2', 2, true)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-2',
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual([
      'workspace-pane:status',
      'terminal:session-1',
      'terminal:session-2',
    ])
    expect(model.activeTab?.identity).toBe('terminal:session-2')
  })

  test('keeps explicit terminal tab order ahead of runtime terminal order', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [terminalEntry('session-2'), staticEntry('status'), terminalEntry('session-1')],
      runtimeTerminalViews: [terminalView('session-1', 1, false), terminalView('session-2', 2, true)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-2',
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual([
      'terminal:session-2',
      'workspace-pane:status',
      'terminal:session-1',
    ])
    expect(model.activeTab?.identity).toBe('terminal:session-2')
  })

  test('keeps terminal selected without a runtime tab while creation is pending', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: true,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['workspace-pane:status', 'static'],
      ['terminal:pending', 'pending'],
    ])
  })

  test('does not add a pending terminal tab during initial terminal sync', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: false,
      terminalSyncReady: false,
      selectedTerminalKey: null,
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([['workspace-pane:status', 'static']])
  })

  test('falls back to the first materialized tab when the preferred worktree static tab is not open', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'changes',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    // The user's preferred tab (changes) was closed; the model surfaces
    // the first materialized tab so they do not land on the empty pane.
    // The store keeps the original preferred tab untouched (not asserted
    // here — that is the store's job), so opening changes again restores
    // the user's intent.
    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'workspace-pane:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('falls back to the first materialized tab when a branch preference names a closed tab', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabOrder: [staticEntry('status'), terminalEntry('session-1')],
      runtimeTerminalViews: [terminalView('session-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    // The user's preferred tab (history) has no materialized tab; the
    // model surfaces the first materialized tab (status) so they do not
    // land on the empty pane. The store keeps history as the preferred
    // tab so the next time the user opens history they land back on it.
    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'workspace-pane:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('returns branch-scope tabs when the selected branch has no worktree', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: null,
      preferredTab: 'status',
      tabOrder: [staticEntry('status'), staticEntry('changes'), terminalEntry('ignored')],
      runtimeTerminalViews: [terminalView('ignored', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.terminalViews).toEqual([])
    expect(model.tabs).toMatchObject([{ identity: 'workspace-pane:status', kind: 'static', type: 'status' }])
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('falls back to the first materialized tab when the last terminal exits a [status, terminal] strip', () => {
    // The user is on a [status, session-1] strip with preferred=terminal.
    // The terminal exits, the runtime snapshot is empty, sync is ready, no
    // pending create. Old behavior: empty pane. New behavior: the model
    // falls back to status (the first materialized tab) so the user does
    // not land on the empty pane. The store keeps preferred=terminal so
    // opening a new terminal returns the user to the terminal tab.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'workspace-pane:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('lands on the remaining terminal when the active terminal is closed among many', () => {
    // The user has [status, session-1, session-2] with session-1 selected.
    // The user closes session-1 (X click) — session-1 is removed from
    // tabOrder, session-2 stays selected in the store. The model
    // re-resolves: preferred=terminal, count=1, session-2 is selected.
    // This is the "natural" case: no fallback needed, the new active
    // terminal is session-2.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status'), terminalEntry('session-2')],
      runtimeTerminalViews: [terminalView('session-2', 2, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-2',
    })

    expect(model.selection).toMatchObject({
      kind: 'materialized-tab',
      tab: 'terminal',
    })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab?.kind === 'terminal' ? model.activeTab.terminalKey : null).toBe('session-2')
  })

  test('keeps the terminal-host view while a terminal create is pending', () => {
    // The fallback is for "preferred tab no longer has a backing tab".
    // When the user is actively creating a new terminal, the model keeps
    // the terminal-host view so the new-terminal affordance remains
    // reachable. preferred=terminal, no materialized terminal, but
    // pendingCreate=true, so the terminal-host is preserved.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: true,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('keeps terminal-host while create is pending after the last tab was closed', () => {
    // Creating a terminal from an empty strip must still mount the terminal
    // host; otherwise the projection waits for host geometry until it times
    // out with error.terminal-host-not-measurable.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: true,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([['terminal:pending', 'pending']])
  })

  test('keeps the terminal-host view while the initial terminal sync is unresolved', () => {
    // Same as above: the user wants terminal and the worktree has no
    // terminal session yet, but sync is not done. We preserve the
    // terminal-host view rather than falling back to status, because the
    // terminal session might appear after sync lands.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: false,
      terminalSyncReady: false,
      selectedTerminalKey: null,
    })

    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('returns no selection when there is no branch at all', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: null,
      worktreePath: null,
      preferredTab: 'status',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    // No branch, no materialized tabs, no fallback — UI shows the empty
    // branch-list state. The fallback never invents a tab that does not
    // exist in the strip.
    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('falls back to tabs[0] for server-side exits', () => {
    // The last terminal exits externally (registry onTerminalSessionRemoved),
    // so the model uses the generic tabs[0] fallback.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'workspace-pane:status', kind: 'static', type: 'status', view: null },
    })
  })

  test('resolves the adjacent tab after close from the shared tab list', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabOrder: [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      runtimeTerminalViews: [terminalView('session-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-1',
    })

    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'workspace-pane:status')?.identity).toBe('terminal:session-1')
    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'workspace-pane:changes')?.identity).toBe('terminal:session-1')
    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'missing:missing')).toBeNull()
  })

  test('skips pending terminal tabs when resolving the next tab after close', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: true,
      terminalSyncReady: true,
      selectedTerminalKey: null,
    })

    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'workspace-pane:status')).toBeNull()
  })

  test('moves through the shared tab list from the active tab identity', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status'), terminalEntry('session-1'), terminalEntry('session-2'), staticEntry('changes')],
      runtimeTerminalViews: [terminalView('session-1', 1, false), terminalView('session-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-2',
    })

    expect(adjacentRepoWorkspaceTab(model.tabs, model.activeTab?.identity, 1)?.identity).toBe('workspace-pane:changes')
    expect(adjacentRepoWorkspaceTab(model.tabs, model.activeTab?.identity, -1)?.identity).toBe('terminal:session-1')
    expect(adjacentRepoWorkspaceTab(model.tabs, null, -1)).toBeNull()
    expect(adjacentRepoWorkspaceTab(model.tabs, 'missing:missing', 1)).toBeNull()
  })

  test('keeps the current terminal selection when another terminal remains selected', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [terminalEntry('session-1'), staticEntry('status'), terminalEntry('session-2')],
      runtimeTerminalViews: [terminalView('session-1', 1, false), terminalView('session-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'session-2',
    })

    expect(model.selection).toMatchObject({ kind: 'materialized-tab', tab: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:session-2')
  })
})

function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabOrderEntry {
  return workspacePaneStaticTabOrderEntry(type)
}

function terminalEntry(id: string): WorkspacePaneTabOrderEntry {
  return workspacePaneTerminalTabOrderEntry(id)
}

function terminalView(terminalKey: string, displayOrder: number, selected: boolean): WorkspacePaneTabSummary {
  return {
    type: 'terminal',
    terminalKey,
    worktreeTerminalKey: WORKTREE_KEY,
    sessionId: terminalKey,
    index: displayOrder,
    displayOrder,
    title: terminalKey,
    phase: 'open',
    selected,
    hasBell: false,
    recentlyActive: false,
  }
}
