import { describe, expect, test } from 'vitest'
import {
  createWorkspacePaneTabModel,
  materializedWorkspacePaneRuntimeTabSessionId,
  workspacePaneTabModelBranchName,
  workspacePaneTabModelWorktreePath,
  workspacePaneRuntimeMaterializationPhase,
  workspacePaneTerminalBaseForTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { nextWorkspacePaneTabEntryAfterClose } from '#/web/workspace-pane/workspace-pane-tab-navigation.ts'
import {
  createModel,
  staticEntry,
  terminalEntry,
  terminalView,
  WORKSPACE_ID,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_KEY,
  WORKTREE_PATH,
} from '#/web/test-utils/workspace-pane-tab-model.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { GitHead } from '#/shared/git-head.ts'
import {
  workspacePaneLocationForLinkedWorktree,
  workspacePaneLocationForRoot,
  workspacePaneLocationForWorktree,
} from '#/web/workspace-pane/workspace-pane-location.ts'

describe('repo workspace pane tab model', () => {
  test('represents active and inactive coordinates without duplicate target state', () => {
    const active = createWorkspacePaneTabModel({
      location: workspacePaneLocationForRoot(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      preferredTab: 'status',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })
    const inactive = createWorkspacePaneTabModel({
      location: null,
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      preferredTab: null,
      tabEntries: [],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })

    expect(active).toMatchObject({ kind: 'active', location: expect.objectContaining({ kind: 'workspace-root' }) })
    expect(active).not.toHaveProperty('routeTarget')
    expect(active).not.toHaveProperty('paneTarget')
    expect(active).not.toHaveProperty('workspaceId')
    expect(inactive).toMatchObject({
      kind: 'inactive',
      location: null,
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
  })

  test('preserves the same target tabs when a worktree becomes detached', () => {
    const modelForHead = (worktreeHead: GitHead) =>
      createWorkspacePaneTabModel({
        location: workspacePaneLocationForLinkedWorktree(
          { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH },
          WORKSPACE_RUNTIME_ID,
          worktreeHead,
        ),
        preferredTab: 'history',
        tabEntries: [staticEntry('status'), staticEntry('changes'), staticEntry('history'), staticEntry('files')],
        runtimeTabViews: [],
        runtimeTabStateByType: {},
      })
    const attached = modelForHead({ kind: 'branch', branchName: 'feature/history' })
    const detached = modelForHead({ kind: 'detached' })

    expect(detached.tabEntries).toEqual(attached.tabEntries)
    expect(detached.tabs.map((tab) => tab.type)).toEqual(attached.tabs.map((tab) => tab.type))
    expect(detached.tabs.map((tab) => tab.type)).toEqual(['status', 'changes', 'history', 'files'])
    expect(detached.renderedTab).toBe('history')
    expect(workspacePaneTerminalBaseForTabModel(detached)).toEqual({
      target: {
        kind: 'git-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        root: workspaceIdForTest('goblin+file:///tmp/goblin-workspace-pane-tab-model-worktree'),
      },
      presentation: { kind: 'git-worktree' },
    })
  })

  test('preserves the materialized branch while a rebase detaches HEAD', () => {
    const location = workspacePaneLocationForWorktree(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, {
      path: WORKTREE_PATH,
      head: { kind: 'detached' },
      headOid: '1111111111111111111111111111111111111111',
      operation: { kind: 'rebase' },
      materializedBranch: 'feature/rebase',
      isSource: false,
      isPrimary: false,
      isLocked: false,
    })
    const model = createWorkspacePaneTabModel({
      location,
      preferredTab: 'status',
      tabEntries: [staticEntry('status')],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })

    expect(workspacePaneTabModelBranchName(model)).toBe('feature/rebase')
  })

  test('projects exactly the authoritative workspace tabs without resurrecting a closed tab', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const model = createWorkspacePaneTabModel({
      location: workspacePaneLocationForRoot(workspaceId, 'repo-runtime-plain'),
      preferredTab: 'files',
      tabEntries: [workspacePaneStaticTabEntry('files')],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })

    expect(workspacePaneTabModelWorktreePath(model)).toBe('/tmp/plain-workspace')
    expect(model.tabs.map((tab) => tab.type)).toEqual(['files'])
    expect(model.renderedTab).toBe('files')
  })

  test('projects one canonical root layout through each presentation surface', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/source-surface-repo')
    const canonicalEntries = [
      staticEntry('status'),
      staticEntry('changes'),
      staticEntry('history'),
      staticEntry('files'),
    ]
    const workspaceRuntimeId = 'source-surface-runtime'
    const projection = {
      tabEntries: canonicalEntries,
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    } as const
    const root = createWorkspacePaneTabModel({
      ...projection,
      location: workspacePaneLocationForRoot(workspaceId, workspaceRuntimeId),
      preferredTab: 'history',
      allowPreferredTabFallback: false,
    })
    const source = createWorkspacePaneTabModel({
      ...projection,
      location: workspacePaneLocationForWorktree(workspaceId, workspaceRuntimeId, {
        path: '/tmp/source-surface-repo',
        head: { kind: 'branch', branchName: 'main' },
        headOid: '1111111111111111111111111111111111111111',
        operation: null,
        materializedBranch: 'main',
        isPrimary: true,
        isSource: true,
        isLocked: false,
      }),
      preferredTab: 'history',
      allowPreferredTabFallback: false,
    })

    expect(root.tabEntries).toEqual(canonicalEntries)
    expect(root.surfaceTabEntries.map((entry) => entry.type)).toEqual(['status', 'files'])
    expect(root.tabs.map((tab) => tab.type)).toEqual(['status', 'files'])
    expect(root.selection).toBeNull()
    expect(source.tabEntries).toEqual(canonicalEntries)
    expect(source.surfaceTabEntries).toEqual(canonicalEntries)
    expect(source.renderedTab).toBe('history')
  })

  test('keeps distinct terminal identities and selects the workspace-scoped terminal projection', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-workspace')
    const model = createWorkspacePaneTabModel({
      location: workspacePaneLocationForRoot(workspaceId, 'repo-runtime-plain'),
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
      location: workspacePaneLocationForRoot(workspaceId, 'repo-runtime-plain'),
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
    expect(model.tabs).toEqual([
      expect.objectContaining({ identity: 'workspace-pane:files', kind: 'static' }),
      expect.objectContaining({
        identity: `terminal:${terminalSessionId}`,
        kind: 'runtime-placeholder',
        projectionPhase: 'pending',
        tabEntry: terminalEntry(terminalSessionId),
      }),
    ])
    expect(workspacePaneRuntimeMaterializationPhase(model.tabs, 'terminal')).toBe('pending')
    if (!model.selectedIdentity) throw new Error('expected selected terminal identity')
    expect(nextWorkspacePaneTabEntryAfterClose(model.tabEntries, model.selectedIdentity)).toEqual(
      workspacePaneStaticTabEntry('files'),
    )
  })

  test('stops reporting a terminal as unmaterialized once its live view is projected', () => {
    const terminalSessionId = 'term-111111111111111111111'
    const model = createModel({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [staticEntry('status'), terminalEntry(terminalSessionId)],
      runtimeTabViews: [terminalView(terminalSessionId, 1, false)],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: terminalSessionId,
    })

    expect(workspacePaneRuntimeMaterializationPhase(model.tabs, 'terminal')).toBeNull()
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

  test('preserves a selected canonical placeholder when another terminal is already materialized', () => {
    const selectedSessionId = 'term-111111111111111111111'
    const materializedSessionId = 'term-222222222222222222222'
    const model = createModel({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'terminal',
      tabEntries: [terminalEntry(selectedSessionId), terminalEntry(materializedSessionId)],
      runtimeTabViews: [terminalView(materializedSessionId, 2, false)],
      terminalProjectionPhase: 'pending',
      selectedTerminalSessionId: selectedSessionId,
    })

    expect(model.activeTab).toBeNull()
    expect(model.selectedIdentity).toBe(`terminal:${selectedSessionId}`)
    expect(model.selection).toMatchObject({ kind: 'runtime-host', runtimeType: 'terminal' })
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
      location: workspacePaneLocationForLinkedWorktree(
        { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH },
        WORKSPACE_RUNTIME_ID,
        { kind: 'branch', branchName: 'feature/model' },
      ),
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

  test.each(['pending', 'failed'] as const)(
    'projects canonical terminal placeholders while the runtime projection is %s',
    (projectionPhase) => {
      const firstTerminalSessionId = 'term-111111111111111111111'
      const secondTerminalSessionId = 'term-222222222222222222222'
      const model = createModel({
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        branchName: 'feature/model',
        worktreePath: WORKTREE_PATH,
        preferredTab: 'terminal',
        tabEntries: [
          terminalEntry(firstTerminalSessionId),
          staticEntry('status'),
          terminalEntry(secondTerminalSessionId),
        ],
        runtimeTabViews: [],
        terminalProjectionPhase: projectionPhase,
        selectedTerminalSessionId: null,
      })

      expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
        [`terminal:${firstTerminalSessionId}`, 'runtime-placeholder'],
        ['workspace-pane:status', 'static'],
        [`terminal:${secondTerminalSessionId}`, 'runtime-placeholder'],
      ])
      expect(model.selectedIdentity).toBe(`terminal:${firstTerminalSessionId}`)
      expect(model.activeTab).toBeNull()
    },
  )

  test('keeps a canonical runtime tab materializing while its view catches up', () => {
    const model = createModel({
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branchName: 'feature/model',
      worktreePath: WORKTREE_PATH,
      preferredTab: 'status',
      tabEntries: [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      runtimeTabViews: [],
      terminalProjectionPhase: 'ready',
      selectedTerminalSessionId: null,
    })

    expect(model.tabs.map((tab) => [tab.identity, tab.kind])).toEqual([
      ['workspace-pane:status', 'static'],
      ['terminal:term-111111111111111111111', 'runtime-placeholder'],
    ])
    expect(model.runtimeTabStateByType.terminal.projectionPhase).toBe('pending')
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
})
