// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  runCloseWorkspacePaneTabOrWindowCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
  runShowWorkspacePaneViewCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  workspacePaneStaticViewsForBranch,
  workspacePaneTabOrderForBranch,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

const REPO_ID = '/tmp/gbl-workspace-command-repo'
const WORKTREE_PATH = '/tmp/gbl-workspace-command-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  resetReposStore()
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('workspace commands', () => {
  test('show workspace pane view command opens status as a branch static view when a worktree exists', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'status', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneView()).toBe('status')
    expect(openViewsFor('feature/worktree')).toEqual(['status'])
  })

  test('show workspace pane view command opens history without routing through status', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'history', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneView()).toBe('history')
    expect(openViewsFor('feature/worktree')).toEqual(['status', 'history'])
  })

  test('show workspace pane view command opens changes as a workspace static tab', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'changes', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneView()).toBe('changes')
    expect(openViewsFor('feature/worktree')).toEqual(['changes'])
  })

  test('show workspace pane view command keeps the previous view when changes has no worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'changes', navigation })).resolves.toBe(false)
    expect(preferredWorkspacePaneView()).toBe('terminal')
    expect(openViewsFor('feature/no-worktree')).toEqual(['status'])
  })

  test('show workspace pane view command opens status for a selected branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'status', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneView()).toBe('status')
  })

  test('terminal primary action opens the terminal view and creates the first terminal when missing', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'terminal-1')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneView()).toBe('terminal')
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('terminal primary action focuses the first existing terminal instead of creating a new one', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'terminal-new')
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [
          {
            type: 'terminal',
            id: 'terminal-1',
            key: 'terminal-1',
            worktreeTerminalKey: WORKTREE_KEY,
            terminalId: 'terminal-1',
            index: 1,
            displayOrder: 1,
            title: 'terminal 1',
            phase: 'open',
            selected: true,
            hasBell: false,
          },
          {
            type: 'terminal',
            id: 'terminal-2',
            key: 'terminal-2',
            worktreeTerminalKey: WORKTREE_KEY,
            terminalId: 'terminal-2',
            index: 2,
            displayOrder: 2,
            title: 'terminal 2',
            phase: 'open',
            selected: false,
            hasBell: false,
          },
        ],
            count: 2,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal,
    })
    const navigation = navigationWith()

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneView()).toBe('terminal')
    expect(createTerminal).not.toHaveBeenCalled()
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
  })

  test('new terminal tab command creates another terminal even when one already exists', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const createTerminal = vi.fn(async () => 'terminal-2')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await runNewTerminalTabCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneView()).toBe('terminal')
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('new terminal tab command moves a reused stale terminal id to the end of the tab order', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [terminalEntry('terminal-1'), staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => 'terminal-1')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await runNewTerminalTabCommand({ repoId: REPO_ID, navigation: navigationWith() })

    expect(tabOrderFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('terminal-1')])
  })

  test('close workspace tab command closes the selected terminal when terminal is active', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('terminal-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn()
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('terminal-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    // Tab removal is owned by the registry's session-removed callback, not the command.
    expect(tabOrderFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('terminal-1')])
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes the selected terminal when it is not the first terminal', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const closeTerminalByDescriptor = vi.fn()
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
      createTerminal: vi.fn(async () => 'terminal-3'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('terminal-2', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes the selected status tab without closing the window', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneView = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneView }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openViewsFor('feature/worktree')).toEqual([])
    // The close command no longer imperatively re-selects the adjacent tab;
    // it records the closing context in the store so the workspace pane tab
    // model can derive the spatial neighbor at read time. Navigation is
    // untouched here.
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.lastClosedTabContextByBranch['feature/worktree'])
      .toEqual({
        closingIdentity: 'status:status',
        previousTabIdentities: ['status:status', 'terminal:terminal-1'],
      })
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes changes as a static tab and signals the closing context to the model', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('terminal-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneView = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneView }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openViewsFor('feature/worktree')).toEqual(['status'])
    // The close command records what was closed (and the pre-close tab order)
    // so the model can derive the spatial neighbor at read time. Preferred
    // view is unchanged — the model flips it to the neighbor via the same
    // derivation.
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('changes')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.lastClosedTabContextByBranch['feature/worktree'])
      .toEqual({
        closingIdentity: 'changes:changes',
        previousTabIdentities: ['status:status', 'terminal:terminal-1', 'changes:changes'],
      })
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command on the only terminal in a mixed strip records the context for spatial adjacency', async () => {
    // Regression: with preferred=terminal and tabOrder=[status, terminal-1, changes],
    // closing terminal-1 must let the model surface changes (the spatial neighbor),
    // not status (materializedTabs[0]). The fix routes adjacency through
    // `lastClosedTabContextByBranch` so the model — not the close command —
    // decides where the user lands. The next model computation reads the
    // recorded context and prefers the neighbor; navigation is untouched.
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('terminal-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneView = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneView }),
        closeWindow,
        targetIdentity: 'terminal:terminal-1',
      }),
    ).toBe(true)
    // The close command does not imperatively navigate. It only records the
    // closing context so the model can derive the spatial neighbor at read time.
    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.lastClosedTabContextByBranch['feature/worktree'])
      .toEqual({
        closingIdentity: 'terminal:terminal-1',
        previousTabIdentities: ['status:status', 'terminal:terminal-1', 'changes:changes'],
      })
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command falls back to closing the window when no workspace tab is selected', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const closeTerminalByDescriptor = vi.fn()
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  test('close workspace tab command does not close the window while the terminal host is pending', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('terminal')
    expect(openViewsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command does not close the window while terminal sync is unresolved', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('terminal')
    expect(openViewsFor('feature/worktree')).toEqual(['status'])
  })

  test('select workspace pane tab by index follows the mixed tab strip order', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('terminal-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal,
    })
    const navigation = navigationWith({ showRepoWorkspacePaneView })

    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 2, navigation })).toBe(true)
    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 3, navigation })).toBe(true)

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
  })

  test('select workspace pane tab by index ignores a pending terminal tab', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith({ showRepoWorkspacePaneView })

    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 2, navigation })).toBe(false)

    expect(showRepoWorkspacePaneView).not.toHaveBeenCalled()
  })

  test('move workspace pane tab command follows the mixed tab strip order', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('terminal-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal,
    })
    const navigation = navigationWith({ showRepoWorkspacePaneView })

    expect(runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, direction: 1, navigation })).toBe(true)
    expect(runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, direction: 1, navigation })).toBe(true)

    expect(showRepoWorkspacePaneView).toHaveBeenNthCalledWith(1, REPO_ID, 'terminal')
    expect(showRepoWorkspacePaneView).toHaveBeenNthCalledWith(2, REPO_ID, 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
  })

  test('move workspace pane tab command works for branch-scope tabs without a worktree', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: { 'feature/no-worktree': [staticEntry('status'), staticEntry('history')] },
    })
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    const navigation = navigationWith({ showRepoWorkspacePaneView })

    expect(runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, direction: 1, navigation })).toBe(true)

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'history')
    expect(preferredWorkspacePaneView()).toBe('history')
  })
})

function preferredWorkspacePaneView() {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) : null
}

function openViewsFor(branch: string) {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticViewsForBranch(repo.ui, branch) : []
}

function tabOrderFor(branch: string): WorkspacePaneTabOrderEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneTabOrderForBranch(repo.ui, branch) : []
}

function staticEntry(type: WorkspacePaneStaticViewType) {
  return workspacePaneStaticTabOrderEntry(type)
}

function terminalEntry(id: string) {
  return { type: 'terminal' as const, id }
}

function navigationWith(overrides: Partial<MainWindowNavigationActions> = {}): MainWindowNavigationActions {
  return {
    activateRepo: (repoId) => useReposStore.getState().setActive(repoId),
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneView: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneView(repoId, tab)
    },
    showRepoBranchWorkspacePaneView: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneView(repoId, tab)
    },
    openSettings: () => {},
    ...overrides,
  }
}

function worktreeSnapshotWithTerminal(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: {
      key: 'terminal-1',
      worktreeTerminalKey: WORKTREE_KEY,
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        id: 'terminal-1',
        key: 'terminal-1',
        worktreeTerminalKey: WORKTREE_KEY,
        terminalId: 'terminal-1',
        index: 1,
        displayOrder: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
    ],
    count: 1,
    bellCount: 0,
    pendingCreate: false,
  }
}

function emptyWorktreeSnapshot(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    pendingCreate: false,
  }
}

function worktreeSnapshotWithSecondTerminalSelected(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: {
      key: 'terminal-2',
      worktreeTerminalKey: WORKTREE_KEY,
      terminalId: 'terminal-2',
      index: 2,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        id: 'terminal-1',
        key: 'terminal-1',
        worktreeTerminalKey: WORKTREE_KEY,
        terminalId: 'terminal-1',
        index: 1,
        displayOrder: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: false,
        hasBell: false,
      },
      {
        type: 'terminal',
        id: 'terminal-2',
        key: 'terminal-2',
        worktreeTerminalKey: WORKTREE_KEY,
        terminalId: 'terminal-2',
        index: 2,
        displayOrder: 2,
        title: 'terminal 2',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
    ],
    count: 2,
    bellCount: 0,
    pendingCreate: false,
  }
}
