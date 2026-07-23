import { describe, expect, test } from 'vitest'
import {
  adjacentWorkspacePaneTab,
  createWorkspacePaneTabModel,
  nextWorkspacePaneTabEntryAfterClose,
  materializedWorkspacePaneRuntimeTabSessionId,
  type WorkspacePaneTabModel,
  type WorkspacePaneTabModelInput,
  type WorkspacePaneRuntimeTabStateInputByType,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/goblin-workspace-pane-tab-model-repo')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/tmp/goblin-workspace-pane-tab-model-worktree'
const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(WORKSPACE_ID, WORKTREE_PATH)

function requiredEntryIdentity(entry: WorkspacePaneTabEntry | null): string {
  if (!entry) throw new Error('expected workspace pane tab entry')
  return workspacePaneTabEntryIdentity(entry)
}

describe('repo workspace pane tab model', () => {
  test('projects only tabs supported by a detached worktree surface and selects a valid fallback', () => {
    const model = createWorkspacePaneTabModel({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH },
      paneTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH },
      worktreeHead: { kind: 'detached' },
      preferredTab: 'history',
      tabEntries: [staticEntry('status'), staticEntry('changes'), staticEntry('history'), staticEntry('files')],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })

    expect(model.tabEntries.map((entry) => entry.type)).toEqual(['status', 'files'])
    expect(model.tabs.map((tab) => tab.type)).toEqual(['status', 'files'])
    expect(model.renderedTab).toBe('status')
  })

  test('projects exactly the authoritative workspace tabs without resurrecting a closed tab', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const model = createWorkspacePaneTabModel({
      workspaceId,
      workspaceRuntimeId: 'repo-runtime-plain',
      routeTarget: { kind: 'workspace-root', workspaceId },
      paneTarget: { kind: 'workspace-root', workspaceId: workspaceId },
      preferredTab: 'files',
      tabEntries: [workspacePaneStaticTabEntry('files')],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })

    expect(model.worktreePath).toBe('/tmp/plain-workspace')
    expect(model.tabs.map((tab) => tab.type)).toEqual(['files'])
    expect(model.renderedTab).toBe('files')
  })

  test('keeps distinct terminal identities and selects the workspace-scoped terminal projection', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const model = createWorkspacePaneTabModel({
      workspaceId,
      workspaceRuntimeId: 'repo-runtime-plain',
      routeTarget: { kind: 'workspace-root', workspaceId },
      paneTarget: { kind: 'workspace-root', workspaceId: workspaceId },
      preferredTab: 'terminal',
      tabEntries: [
        workspacePaneStaticTabEntry('files'),
        terminalEntry('term-111111111111111111111'),
        terminalEntry('term-222222222222222222222'),
      ],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'ready', selectedSessionId: 'term-222222222222222222222' },
      },
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual([
      'workspace-pane:files',
      'terminal:term-111111111111111111111',
      'terminal:term-222222222222222222222',
    ])
    expect(model.activeTab?.identity).toBe('terminal:term-222222222222222222222')
  })

  test('keeps the canonical selected terminal entry while its live view is not projected', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const terminalSessionId = 'term-111111111111111111111'
    const model = createWorkspacePaneTabModel({
      workspaceId,
      workspaceRuntimeId: 'repo-runtime-plain',
      routeTarget: { kind: 'workspace-root', workspaceId },
      paneTarget: { kind: 'workspace-root', workspaceId: workspaceId },
      preferredTab: 'terminal',
      allowPreferredTabFallback: false,
      tabEntries: [workspacePaneStaticTabEntry('files'), terminalEntry(terminalSessionId)],
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: { projectionPhase: 'pending', selectedSessionId: terminalSessionId },
      },
      requestedSessionIdByRuntimeType: { terminal: terminalSessionId },
    })

    expect(model.activeTab).toBeNull()
    expect(model.selectedEntry).toEqual(terminalEntry(terminalSessionId))
    expect(model.selectedIdentity).toBe(`terminal:${terminalSessionId}`)
    if (!model.selectedIdentity) throw new Error('expected selected terminal identity')
    expect(nextWorkspacePaneTabEntryAfterClose(model.tabEntries, model.selectedIdentity)).toEqual(
      workspacePaneStaticTabEntry('files'),
    )
  })

  test('projects a mixed tab list across static and terminal tabs', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabEntries: [
        terminalEntry('term-111111111111111111111'),
        staticEntry('status'),
        staticEntry('changes'),
        staticEntry('history'),
      ],
      runtimeTabViews: [terminalView('term-111111111111111111111', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.runtimeTabTargetKey).toBe(WORKTREE_KEY)
    expect(model.runtimeViewsByType.terminal.map((view) => view.type)).toEqual(['terminal'])
    expect(model.staticTabs).toEqual(['status', 'changes', 'history'])
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['terminal:term-111111111111111111111', 'runtime'],
      ['workspace-pane:status', 'static'],
      ['workspace-pane:changes', 'static'],
      ['workspace-pane:history', 'static'],
    ])
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('uses the selected terminal from the store as the active terminal tab', () => {
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
      ],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toMatchObject({ kind: 'materialized-tab', tab: 'terminal' })
    expect(model.activeTab?.identity).toBe('terminal:term-222222222222222222222')
    expect(materializedWorkspacePaneRuntimeTabSessionId(model.activeTab, 'terminal')).toBe('term-222222222222222222222')
  })

  test('uses runtime tab state as the selected-session source', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [terminalEntry('term-111111111111111111111'), terminalEntry('term-222222222222222222222')],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      runtimeTabStateByType: {
        terminal: {
          createPending: false,
          projectionPhase: 'ready',
          selectedSessionId: 'term-222222222222222222222',
        },
      },
      selectedTerminalSessionId: 'term-111111111111111111111',
    })

    expect(model.runtimeTabStateByType.terminal).toMatchObject({
      createPending: false,
      projectionPhase: 'ready',
      selectedSessionId: 'term-222222222222222222222',
    })
    expect(materializedWorkspacePaneRuntimeTabSessionId(model.activeTab, 'terminal')).toBe('term-222222222222222222222')
  })

  test('uses a requested runtime session for the active tab without rewriting projection state', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [terminalEntry('term-111111111111111111111'), terminalEntry('term-222222222222222222222')],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-111111111111111111111',
      requestedSessionIdByRuntimeType: { terminal: 'term-222222222222222222222' },
    })

    expect(model.runtimeTabStateByType.terminal.selectedSessionId).toBe('term-111111111111111111111')
    expect(materializedWorkspacePaneRuntimeTabSessionId(model.activeTab, 'terminal')).toBe('term-222222222222222222222')
  })

  test('does not fall back to another terminal when a requested runtime session is missing', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [terminalEntry('term-111111111111111111111'), terminalEntry('term-222222222222222222222')],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      terminalProjectionPhase: 'pending',
      selectedTerminalSessionId: 'term-222222222222222222222',
      requestedSessionIdByRuntimeType: { terminal: 'missing-session' },
    })

    expect(model.runtimeTabStateByType.terminal.selectedSessionId).toBe('term-222222222222222222222')
    expect(model.selection).toEqual({
      kind: 'runtime-host',
      tab: 'terminal',
      runtimeType: 'terminal',
      materializedTab: null,
    })
    expect(model.activeTab).toBeNull()
  })

  test('does not render a runtime host for a verified missing explicit terminal route', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      allowPreferredTabFallback: false,
      tabEntries: [
        staticEntry('status'),
        terminalEntry('term-111111111111111111111'),
        terminalEntry('term-222222222222222222222'),
      ],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, false),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
      requestedSessionIdByRuntimeType: { terminal: 'missing-session' },
    })

    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('creates pending runtime tabs from runtime tab state', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      runtimeTabStateByType: {
        terminal: {
          createPending: true,
          projectionPhase: 'ready',
          selectedSessionId: null,
        },
      },
    })

    expect(model.runtimeTabStateByType.terminal.createPending).toBe(true)
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['workspace-pane:status', 'static'],
      ['terminal:pending', 'pending'],
    ])
  })

  test('defaults runtime tab state by runtime type when no input state is provided', () => {
    const model = createWorkspacePaneTabModel({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature/model' },
      paneTarget: requiredGitWorkspacePaneTabsTarget(WORKSPACE_ID, 'feature/model', WORKTREE_PATH),
      worktreeHead: { kind: 'branch', branchName: 'feature/model' },
      preferredTab: 'status',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })

    expect(model.runtimeTabStateByType.terminal).toEqual({
      type: 'terminal',
      createPending: false,
      projectionPhase: 'pending',
      projectionErrorMessage: undefined,
      selectedSessionId: null,
    })
  })

  test('does not materialize runtime-only terminals outside the server tab list', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status'), terminalEntry('term-222222222222222222222')],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, true),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual([
      'workspace-pane:status',
      'terminal:term-222222222222222222222',
    ])
    expect(model.activeTab?.identity).toBe('terminal:term-222222222222222222222')
  })

  test('falls back when the preferred terminal is runtime-only and not in the server tab list', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [terminalView('term-111111111111111111111', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-111111111111111111111',
    })

    expect(model.renderedTab).toBe('status')
    expect(model.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status'])
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('keeps explicit terminal tab entries ahead of the runtime terminal snapshot list', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [
        terminalEntry('term-222222222222222222222'),
        staticEntry('status'),
        terminalEntry('term-111111111111111111111'),
      ],
      runtimeTabViews: [
        terminalView('term-111111111111111111111', 1, false),
        terminalView('term-222222222222222222222', 2, true),
      ],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual([
      'terminal:term-222222222222222222222',
      'workspace-pane:status',
      'terminal:term-111111111111111111111',
    ])
    expect(model.activeTab?.identity).toBe('terminal:term-222222222222222222222')
  })

  test('keeps terminal selected without a runtime tab while creation is pending', () => {
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

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toEqual({
      kind: 'runtime-host',
      tab: 'terminal',
      runtimeType: 'terminal',
      materializedTab: null,
    })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['workspace-pane:status', 'static'],
      ['terminal:pending', 'pending'],
    ])
  })

  test('does not add a pending terminal tab during initial terminal sync', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalCreatePending: false,
      terminalProjectionPhase: 'pending',
      selectedTerminalSessionId: null,
    })

    expect(model.renderedTab).toBe('terminal')
    expect(model.selection).toEqual({
      kind: 'runtime-host',
      tab: 'terminal',
      runtimeType: 'terminal',
      materializedTab: null,
    })
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([['workspace-pane:status', 'static']])
  })

  test('falls back to the first materialized tab when the preferred worktree static tab is not open', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'changes',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
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

  test('does not fall back when an explicit static route is not materialized', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'changes',
      allowPreferredTabFallback: false,
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status'])
    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('falls back to the first materialized tab when a branch preference names a closed tab', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'history',
      tabEntries: [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      runtimeTabViews: [terminalView('term-111111111111111111111', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
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
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: null,
      preferredTab: 'status',
      tabEntries: [staticEntry('status'), staticEntry('changes'), terminalEntry('ignored')],
      runtimeTabViews: [terminalView('ignored', 1, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.runtimeViewsByType.terminal).toEqual([])
    expect(model.tabs).toMatchObject([{ identity: 'workspace-pane:status', kind: 'static', type: 'status' }])
    expect(model.activeTab?.identity).toBe('workspace-pane:status')
  })

  test('falls back to the first materialized tab when the last terminal exits a [status, terminal] strip', () => {
    // The user is on a [status, term-111111111111111111111] strip with preferred=terminal.
    // The terminal exits, the runtime snapshot is empty, sync is ready, no
    // pending create. Old behavior: empty pane. New behavior: the model
    // falls back to status (the first materialized tab) so the user does
    // not land on the empty pane. The store keeps preferred=terminal so
    // opening a new terminal returns the user to the terminal tab.
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
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
    // The user has [status, term-111111111111111111111, term-222222222222222222222] with term-111111111111111111111 selected.
    // The user closes term-111111111111111111111 (X click) — term-111111111111111111111 is removed from
    // tabs, term-222222222222222222222 stays selected in the store. The model
    // re-resolves: preferred=terminal, count=1, term-222222222222222222222 is selected.
    // This is the "natural" case: no fallback needed, the new active
    // terminal is term-222222222222222222222.
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status'), terminalEntry('term-222222222222222222222')],
      runtimeTabViews: [terminalView('term-222222222222222222222', 2, true)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: 'term-222222222222222222222',
    })

    expect(model.selection).toMatchObject({
      kind: 'materialized-tab',
      tab: 'terminal',
    })
    expect(model.renderedTab).toBe('terminal')
    expect(materializedWorkspacePaneRuntimeTabSessionId(model.activeTab, 'terminal')).toBe('term-222222222222222222222')
  })

  test('keeps the runtime-host view while a terminal create is pending', () => {
    // The fallback is for "preferred tab no longer has a backing tab".
    // When the user is actively creating a new terminal, the model keeps
    // the runtime-host view so the new-terminal affordance remains
    // reachable. preferred=terminal, no materialized terminal, but
    // createPending=true, so the runtime-host is preserved.
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

    expect(model.selection).toEqual({
      kind: 'runtime-host',
      tab: 'terminal',
      runtimeType: 'terminal',
      materializedTab: null,
    })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('keeps runtime-host while create is pending after the last tab was closed', () => {
    // Creating from an empty strip must preserve the runtime presentation
    // surface. The prepared session can then mount and fit its real xterm
    // before attach; this host is not a create-time geometry provider.
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [],
      runtimeTabViews: [],
      terminalCreatePending: true,
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.selection).toEqual({
      kind: 'runtime-host',
      tab: 'terminal',
      runtimeType: 'terminal',
      materializedTab: null,
    })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([['terminal:pending', 'pending']])
  })

  test('keeps the runtime-host view while the initial terminal sync is unresolved', () => {
    // Same as above: the user wants terminal and the worktree has no
    // terminal session yet, but sync is not done. We preserve the
    // runtime-host view rather than falling back to status, because the
    // terminal session might appear after sync lands.
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalCreatePending: false,
      terminalProjectionPhase: 'pending',
      selectedTerminalSessionId: null,
    })

    expect(model.selection).toEqual({
      kind: 'runtime-host',
      tab: 'terminal',
      runtimeType: 'terminal',
      materializedTab: null,
    })
    expect(model.renderedTab).toBe('terminal')
    expect(model.activeTab).toBeNull()
  })

  test('returns no selection when there is no branch at all', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: null,
      worktreePath: null,
      preferredTab: 'status',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    // No branch, no materialized tabs, no fallback — UI shows the empty
    // branch-list state. The fallback never invents a tab that does not
    // exist in the strip.
    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('keeps bare branch routes on the empty workspace pane', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: null,
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status'])
    expect(model.selection).toBeNull()
    expect(model.renderedTab).toBeNull()
    expect(model.activeTab).toBeNull()
  })

  test('falls back to tabs[0] for server-side exits', () => {
    // The last terminal exits externally through the server workspace tab list,
    // so the model uses the generic tabs[0] fallback.
    const model = createModel({
      workspaceId: WORKSPACE_ID,

      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.selection).toEqual({
      kind: 'materialized-tab',
      tab: 'status',
      materializedTab: { identity: 'workspace-pane:status', kind: 'static', type: 'status', view: null },
    })
  })

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

type WorkspacePaneTabModelTestInput = Omit<
  WorkspacePaneTabModelInput,
  'workspaceRuntimeId' | 'runtimeTabStateByType' | 'routeTarget' | 'paneTarget' | 'worktreeHead'
> & {
  branchName: string | null
  worktreePath: string | null
  workspaceRuntimeId?: string
  runtimeTabStateByType?: WorkspacePaneRuntimeTabStateInputByType
  terminalCreatePending?: boolean
  terminalProjectionPhase?: WorkspacePaneRuntimeProjectionPhase
  terminalProjectionErrorMessage?: string
  selectedTerminalSessionId?: string | null
}

function createModel(input: WorkspacePaneTabModelTestInput): WorkspacePaneTabModel {
  const {
    branchName,
    worktreePath,
    workspaceRuntimeId,
    runtimeTabStateByType,
    terminalCreatePending,
    terminalProjectionPhase,
    terminalProjectionErrorMessage,
    selectedTerminalSessionId,
    ...modelInput
  } = input
  const terminalState = runtimeTabStateByType?.terminal
  const hasSelectedTerminalSession = terminalState
    ? Object.prototype.hasOwnProperty.call(terminalState, 'selectedSessionId')
    : false
  return createWorkspacePaneTabModel({
    workspaceRuntimeId: workspaceRuntimeId ?? WORKSPACE_RUNTIME_ID,
    ...modelInput,
    routeTarget: branchName
      ? { kind: 'git-branch', workspaceId: modelInput.workspaceId, branchName }
      : worktreePath === modelInput.workspaceId
        ? { kind: 'workspace-root', workspaceId: modelInput.workspaceId }
        : { kind: 'inactive', workspaceId: modelInput.workspaceId },
    paneTarget: branchName
      ? requiredGitWorkspacePaneTabsTarget(modelInput.workspaceId, branchName, worktreePath)
      : worktreePath === modelInput.workspaceId
        ? { kind: 'workspace-root', workspaceId: modelInput.workspaceId }
        : { kind: 'inactive', workspaceId: modelInput.workspaceId },
    worktreeHead: branchName && worktreePath ? { kind: 'branch', branchName } : undefined,
    runtimeTabStateByType: {
      ...runtimeTabStateByType,
      terminal: {
        createPending: terminalState?.createPending ?? terminalCreatePending ?? false,
        projectionPhase: terminalState?.projectionPhase ?? terminalProjectionPhase ?? 'pending',
        projectionErrorMessage: terminalState?.projectionErrorMessage ?? terminalProjectionErrorMessage,
        selectedSessionId: hasSelectedTerminalSession
          ? (terminalState?.selectedSessionId ?? null)
          : (selectedTerminalSessionId ?? null),
      },
    },
  })
}

function staticEntry(type: WorkspacePaneStaticTabType): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

function terminalView(terminalSessionId: string, index: number, selected: boolean): WorkspacePaneTabSummary {
  return {
    type: 'terminal',
    terminalSessionId,
    terminalFilesystemTargetKey: WORKTREE_KEY,
    index,
    title: terminalSessionId,
    phase: 'open',
    selected,
    hasBell: false,
    hasRecentOutput: false,
  }
}
