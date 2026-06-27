import { describe, expect, test } from 'vitest'
import {
  adjacentRepoWorkspaceTab,
  createRepoWorkspaceTabModel,
  nextRepoWorkspaceTabAfterClose,
} from '#/web/components/repo-workspace/tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'

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
      tabOrder: [terminalEntry('slot-1'), staticEntry('status'), staticEntry('changes'), staticEntry('history')],
      runtimeTerminalViews: [terminalView('slot-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: null,
      lastClosedTabContext: null,
    })

    expect(model.worktreeTerminalKey).toBe(WORKTREE_KEY)
    expect(model.terminalViews.map((view) => view.type)).toEqual(['terminal'])
    expect(model.staticTabs).toEqual(['status', 'changes', 'history'])
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['terminal:slot-1', 'terminal'],
      ['status:status', 'static'],
      ['changes:changes', 'static'],
      ['history:history', 'static'],
    ])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('uses the selected terminal from the store as the active terminal tab', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [terminalView('slot-1', 1, false), terminalView('slot-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'slot-2',
      lastClosedTabContext: null,
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toMatchObject({ kind: 'materialized-tab', tab: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:slot-2')
    expect(model.activeTab?.kind === 'terminal' ? model.activeTab.key : null).toBe('slot-2')
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
      lastClosedTabContext: null,
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['status:status', 'static'],
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
      lastClosedTabContext: null,
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([['status:status', 'static']])
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
      lastClosedTabContext: null,
    })

    // The user's preferred tab (changes) was closed; the model surfaces
    // the first materialized tab so they do not land on the empty pane.
    // The store keeps the original preferred tab untouched (not asserted
    // here — that is the store's job), so opening changes again restores
    // the user's intent.
    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('falls back to the first materialized tab when a branch preference names a closed tab', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabOrder: [staticEntry('status'), terminalEntry('slot-1')],
      runtimeTerminalViews: [terminalView('slot-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: null,
      lastClosedTabContext: null,
    })

    // The user's preferred tab (history) has no materialized tab; the
    // model surfaces the first materialized tab (status) so they do not
    // land on the empty pane. The store keeps history as the preferred
    // tab so the next time the user opens history they land back on it.
    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
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
      lastClosedTabContext: null,
    })

    expect(model.terminalViews).toEqual([])
    expect(model.tabs).toMatchObject([{ identity: 'status:status', kind: 'static', type: 'status' }])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('falls back to the first materialized tab when the last terminal exits a [status, terminal] strip', () => {
    // The user is on a [status, slot-1] strip with preferred=terminal.
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
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('lands on the remaining terminal when the active terminal is closed among many', () => {
    // The user has [status, slot-1, slot-2] with slot-1 selected.
    // The user closes slot-1 (X click) — slot-1 is removed from
    // tabOrder, slot-2 stays selected in the store. The model
    // re-resolves: preferred=terminal, count=1, slot-2 is selected.
    // This is the "natural" case: no fallback needed, the new active
    // terminal is slot-2.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status'), terminalEntry('slot-2')],
      runtimeTerminalViews: [terminalView('slot-2', 2, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: 'slot-2',
      lastClosedTabContext: null,
    })

    expect(model.selection).toMatchObject({
      kind: 'materialized-tab',
      tab: 'terminal',
    })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab?.kind === 'terminal' ? model.activeTab.key : null).toBe('slot-2')
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
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({ kind: 'terminal-host', tab: 'terminal', materializedTab: null })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('keeps terminal-host while create is pending after the last tab was closed', () => {
    // Regression: closing every workspace tab leaves a close context behind.
    // Creating a terminal from that empty strip must still mount the
    // terminal host; otherwise the projection waits for host geometry until it
    // times out with error.terminal-host-not-measurable.
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
      lastClosedTabContext: {
        closingIdentity: 'status:status',
        previousTabIdentities: ['status:status'],
      },
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
      lastClosedTabContext: null,
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
      lastClosedTabContext: null,
    })

    // No branch, no materialized tabs, no fallback — UI shows the empty
    // branch-list state. The fallback never invents a tab that does not
    // exist in the strip.
    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('lands on the spatial neighbor via lastClosedTabContext when the only terminal in a mixed strip is closed', () => {
    // Regression: preferred=terminal + tabOrder=[status, slot-1, changes] +
    // the last terminal exits. The store records closingIdentity=slot-1
    // with the pre-close tab identities; the model uses it to surface changes
    // (the spatial neighbor of slot-1) instead of status (tabs[0]).
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status'), staticEntry('changes')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
      lastClosedTabContext: {
        closingIdentity: 'terminal:slot-1',
        previousTabIdentities: ['status:status', 'terminal:slot-1', 'changes:changes'],
      },
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'changes',
      materializedTab: { identity: 'changes:changes', kind: 'static', type: 'changes', view: null },
    })
    expect(model.renderedTab).toBe('changes')
    expect(model.activeTab?.identity).toBe('changes:changes')
  })

  test('falls back to tabs[0] when lastClosedTabContext has no neighbor (single tab closed)', () => {
    // Closing the only tab in a [status] strip: pre-close has only status,
    // so there is no neighbor to surface. The model falls back to its
    // generic tabs[0] lookup, which is also null here, and returns no
    // selection.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'changes',
      tabOrder: [],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
      lastClosedTabContext: {
        closingIdentity: 'status:status',
        previousTabIdentities: ['status:status'],
      },
    })

    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
  })

  test('ignores lastClosedTabContext when the preferred tab is renderable', () => {
    // If the user closes a tab but their preferred tab is still open, the
    // model picks the preferred tab directly — lastClosedTabContext only
    // applies when the preferred tab became unrenderable.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabOrder: [staticEntry('status'), staticEntry('changes')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      selectedTerminalKey: null,
      lastClosedTabContext: {
        closingIdentity: 'changes:changes',
        previousTabIdentities: ['status:status', 'changes:changes'],
      },
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
  })

  test('falls back to tabs[0] for server-side exits with no lastClosedTabContext', () => {
    // The last terminal exits externally (registry onTerminalSessionRemoved),
    // no user-initiated close recorded. The model has no adjacency hint, so
    // it uses the generic tabs[0] fallback.
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
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
  })

  test('resolves the adjacent tab after close from the shared tab list', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabOrder: [staticEntry('status'), terminalEntry('slot-1'), staticEntry('changes')],
      runtimeTerminalViews: [terminalView('slot-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      selectedTerminalKey: 'slot-1',
      lastClosedTabContext: null,
    })

    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'status:status')?.identity).toBe('terminal:slot-1')
    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'changes:changes')?.identity).toBe('terminal:slot-1')
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
      lastClosedTabContext: null,
    })

    expect(nextRepoWorkspaceTabAfterClose(model.tabs, 'status:status')).toBeNull()
  })

  test('moves through the shared tab list from the active tab identity', () => {
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [staticEntry('status'), terminalEntry('slot-1'), terminalEntry('slot-2'), staticEntry('changes')],
      runtimeTerminalViews: [terminalView('slot-1', 1, false), terminalView('slot-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'slot-2',
      lastClosedTabContext: null,
    })

    expect(adjacentRepoWorkspaceTab(model.tabs, model.activeTab?.identity, 1)?.identity).toBe('changes:changes')
    expect(adjacentRepoWorkspaceTab(model.tabs, model.activeTab?.identity, -1)?.identity).toBe('terminal:slot-1')
    expect(adjacentRepoWorkspaceTab(model.tabs, null, -1)).toBeNull()
    expect(adjacentRepoWorkspaceTab(model.tabs, 'missing:missing', 1)).toBeNull()
  })

  test('prefers the spatial neighbor when the active terminal is closed and another terminal remains', () => {
    // Regression: with preferred=terminal and a mixed strip, closing the active
    // rightmost terminal must land on the adjacent tab in strip order (the
    // static tab in the middle), not jump to the leftmost remaining terminal
    // just because the terminal tab is still renderable.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [terminalEntry('slot-1'), staticEntry('status'), terminalEntry('slot-2')],
      runtimeTerminalViews: [terminalView('slot-1', 1, false), terminalView('slot-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'slot-2',
      lastClosedTabContext: {
        closingIdentity: 'terminal:slot-2',
        previousTabIdentities: ['terminal:slot-1', 'status:status', 'terminal:slot-2'],
        wasActive: true,
      },
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedTab).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('keeps the current terminal selection when a background terminal is closed', () => {
    // Closing a non-active terminal must not hijack the active selection via
    // the spatial neighbor logic.
    const model = createRepoWorkspaceTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabOrder: [terminalEntry('slot-1'), staticEntry('status'), terminalEntry('slot-2')],
      runtimeTerminalViews: [terminalView('slot-1', 1, false), terminalView('slot-2', 2, false)],
      terminalSessionCount: 2,
      terminalSyncReady: true,
      selectedTerminalKey: 'slot-2',
      lastClosedTabContext: {
        closingIdentity: 'terminal:slot-1',
        previousTabIdentities: ['terminal:slot-1', 'status:status', 'terminal:slot-2'],
        wasActive: false,
      },
    })

    expect(model.selection).toMatchObject({ kind: 'materialized-tab', tab: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:slot-2')
  })
})

function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabOrderEntry {
  return { type, id: type }
}

function terminalEntry(id: string): WorkspacePaneTabOrderEntry {
  return { type: 'terminal', id }
}

function terminalView(key: string, displayOrder: number, selected: boolean): WorkspacePaneTabSummary {
  return {
    type: 'terminal',
    id: key,
    key,
    worktreeTerminalKey: WORKTREE_KEY,
    slotId: key,
    index: displayOrder,
    displayOrder,
    title: key,
    phase: 'open',
    selected,
    hasBell: false,
  }
}
