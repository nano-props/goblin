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
      lastClosedTabContext: null,
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
      lastClosedTabContext: null,
    })

    expect(model.renderedView).toBe('terminal')
    expect(model.selection).toMatchObject({ kind: 'materialized-tab', view: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:terminal-2')
    expect(model.activeTab?.kind === 'terminal' ? model.activeTab.key : null).toBe('terminal-2')
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
      lastClosedTabContext: null,
    })

    expect(model.renderedView).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', view: 'terminal', tab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['status:status', 'static'],
      ['terminal:pending', 'pending'],
    ])
  })

  test('does not add a pending terminal tab during initial terminal sync', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: false,
      terminalSyncReady: false,
      lastClosedTabContext: null,
    })

    expect(model.renderedView).toBe('terminal')
    expect(model.selection).toEqual({ kind: 'terminal-host', view: 'terminal', tab: null })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([['status:status', 'static']])
  })

  test('falls back to the first materialized tab when the preferred worktree static view is not open', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'changes',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: null,
    })

    // The user's preferred view (changes) was closed; the model surfaces
    // the first materialized tab so they do not land on the empty pane.
    // The store keeps the original preferred view untouched (not asserted
    // here — that is the store's job), so opening changes again restores
    // the user's intent.
    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      view: 'status',
      tab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedView).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('falls back to the first materialized tab when a branch preference names a closed tab', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'history',
      tabOrder: [staticEntry('status'), terminalEntry('terminal-1')],
      runtimeTerminalViews: [terminalView('terminal-1', 1, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      lastClosedTabContext: null,
    })

    // The user's preferred view (history) has no materialized tab; the
    // model surfaces the first materialized tab (status) so they do not
    // land on the empty pane. The store keeps history as the preferred
    // view so the next time the user opens history they land back on it.
    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      view: 'status',
      tab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedView).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
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
      lastClosedTabContext: null,
    })

    expect(model.terminalViews).toEqual([])
    expect(model.tabs).toMatchObject([{ identity: 'status:status', kind: 'static', type: 'status' }])
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('falls back to the first materialized tab when the last terminal exits a [status, terminal] strip', () => {
    // The user is on a [status, terminal-1] strip with preferred=terminal.
    // The terminal exits, the runtime snapshot is empty, sync is ready, no
    // pending create. Old behavior: empty pane. New behavior: the model
    // falls back to status (the first materialized tab) so the user does
    // not land on the empty pane. The store keeps preferred=terminal so
    // opening a new terminal returns the user to the terminal view.
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      view: 'status',
      tab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
    expect(model.renderedView).toBe('status')
    expect(model.activeTab?.identity).toBe('status:status')
  })

  test('lands on the remaining terminal when the active terminal is closed among many', () => {
    // The user has [status, terminal-1, terminal-2] with terminal-1 selected.
    // The user closes terminal-1 (X click) — terminal-1 is removed from
    // tabOrder, terminal-2 stays selected in the registry. The model
    // re-resolves: preferred=terminal, count=1, terminal-2 is selected.
    // This is the "natural" case: no fallback needed, the new active
    // terminal is terminal-2.
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status'), terminalEntry('terminal-2')],
      runtimeTerminalViews: [terminalView('terminal-2', 2, true)],
      terminalSessionCount: 1,
      terminalSyncReady: true,
      lastClosedTabContext: null,
    })

    expect(model.selection).toMatchObject({
      kind: 'materialized-tab',
      view: 'terminal',
    })
    expect(model.renderedView).toBe('terminal')
    expect(model.activeTab?.kind === 'terminal' ? model.activeTab.key : null).toBe('terminal-2')
  })

  test('keeps the terminal-host view while a terminal create is pending', () => {
    // The fallback is for "preferred view no longer has a backing tab".
    // When the user is actively creating a new terminal, the model keeps
    // the terminal-host view so the new-terminal affordance remains
    // reachable. preferred=terminal, no materialized terminal, but
    // pendingCreate=true, so the terminal-host is preserved.
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
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({ kind: 'terminal-host', view: 'terminal', tab: null })
    expect(model.renderedView).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('keeps the terminal-host view while the initial terminal sync is unresolved', () => {
    // Same as above: the user wants terminal and the worktree has no
    // terminal session yet, but sync is not done. We preserve the
    // terminal-host view rather than falling back to status, because the
    // terminal session might appear after sync lands.
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalCreatePending: false,
      terminalSyncReady: false,
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({ kind: 'terminal-host', view: 'terminal', tab: null })
    expect(model.renderedView).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('returns no selection when there is no branch at all', () => {
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: null,
      worktreePath: null,
      preferredView: 'status',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: null,
    })

    // No branch, no materialized tabs, no fallback — UI shows the empty
    // branch-list state. The fallback never invents a tab that does not
    // exist in the strip.
    expect(model.selection).toBeNull()
    expect(model.renderedView).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('lands on the spatial neighbor via lastClosedTabContext when the only terminal in a mixed strip is closed', () => {
    // Regression: preferred=terminal + tabOrder=[status, terminal-1, changes] +
    // the last terminal exits. The store records closingIdentity=terminal-1
    // with the pre-close tab identities; the model uses it to surface changes
    // (the spatial neighbor of terminal-1) instead of status (tabs[0]).
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status'), staticEntry('changes')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: {
        closingIdentity: 'terminal:terminal-1',
        previousTabIdentities: ['status:status', 'terminal:terminal-1', 'changes:changes'],
      },
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      view: 'changes',
      tab: { identity: 'changes:changes', kind: 'static', type: 'changes', view: null },
    })
    expect(model.renderedView).toBe('changes')
    expect(model.activeTab?.identity).toBe('changes:changes')
  })

  test('falls back to tabs[0] when lastClosedTabContext has no neighbor (single tab closed)', () => {
    // Closing the only tab in a [status] strip: pre-close has only status,
    // so there is no neighbor to surface. The model falls back to its
    // generic tabs[0] lookup, which is also null here, and returns no
    // selection.
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'changes',
      tabOrder: [],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: {
        closingIdentity: 'status:status',
        previousTabIdentities: ['status:status'],
      },
    })

    expect(model.selection).toBeNull()
    expect(model.renderedView).toBeNull()
  })

  test('ignores lastClosedTabContext when the preferred view is renderable', () => {
    // If the user closes a tab but their preferred view is still open, the
    // model picks the preferred view directly — lastClosedTabContext only
    // applies when the preferred view became unrenderable.
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'status',
      tabOrder: [staticEntry('status'), staticEntry('changes')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: {
        closingIdentity: 'changes:changes',
        previousTabIdentities: ['status:status', 'changes:changes'],
      },
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      view: 'status',
      tab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
  })

  test('falls back to tabs[0] for server-side exits with no lastClosedTabContext', () => {
    // The last terminal exits externally (registry onTerminalSessionRemoved),
    // no user-initiated close recorded. The model has no adjacency hint, so
    // it uses the generic tabs[0] fallback.
    const model = createBranchWorkspacePaneTabModel({
      repoId: REPO_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredView: 'terminal',
      tabOrder: [staticEntry('status')],
      runtimeTerminalViews: [],
      terminalSessionCount: 0,
      terminalSyncReady: true,
      lastClosedTabContext: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      view: 'status',
      tab: { identity: 'status:status', kind: 'static', type: 'status', view: null },
    })
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
      lastClosedTabContext: null,
    })

    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'status:status')?.identity).toBe('terminal:terminal-1')
    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'changes:changes')?.identity).toBe('terminal:terminal-1')
    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'missing:missing')).toBeNull()
  })

  test('skips pending terminal tabs when resolving the next tab after close', () => {
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
      lastClosedTabContext: null,
    })

    expect(nextBranchWorkspacePaneTabAfterClose(model.tabs, 'status:status')).toBeNull()
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
      lastClosedTabContext: null,
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
