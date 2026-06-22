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
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'

const REPO_ID = '/tmp/gbl-workspace-command-repo'
const WORKTREE_PATH = '/tmp/gbl-workspace-command-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  resetReposStore()
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
      openBranchWorkspacePaneViews: [],
    })
    const openWorkspacePaneView = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'status', navigation })).resolves.toBe(true)

    expect(openWorkspacePaneView).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('status')
  })

  test('show workspace pane view command opens history without routing through status', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      openBranchWorkspacePaneViews: ['status'],
    })
    const openWorkspacePaneView = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'history', navigation })).resolves.toBe(true)

    expect(openWorkspacePaneView).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('history')
  })

  test('show workspace pane view command opens changes as a worktree-level view', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      openBranchWorkspacePaneViews: [],
    })
    const openWorkspacePaneView = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'changes', navigation })).resolves.toBe(true)

    expect(openWorkspacePaneView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
    expect(preferredWorkspacePaneView()).toBe('changes')
  })

  test('show workspace pane view command keeps the previous view when changes fails to open', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const openWorkspacePaneView = vi.fn(async () => false)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'changes', navigation })).resolves.toBe(false)

    expect(openWorkspacePaneView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
    expect(preferredWorkspacePaneView()).toBe('terminal')
  })

  test('show workspace pane view command opens status for a selected branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const openWorkspacePaneView = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab: 'status', navigation })).resolves.toBe(true)

    expect(openWorkspacePaneView).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('status')
  })

  test('terminal primary action opens the terminal view and creates the first terminal when missing', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
      openBranchWorkspacePaneViews: ['status'],
    })
    const createTerminal = vi.fn(async () => 'terminal-1')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal: vi.fn(),
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
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
      openBranchWorkspacePaneViews: ['status'],
    })
    const createTerminal = vi.fn(async () => 'terminal-new')
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
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
        workspacePaneViews: [
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
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
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
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
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

  test('close workspace tab command closes the selected terminal when terminal is active', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const closeTerminalByDescriptor = vi.fn()
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('terminal-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
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
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
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
    const closeWorkspacePaneView = vi.fn(async () => true)
    const closeWindow = vi.fn()
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal,
      closeTerminalByDescriptor: vi.fn(),
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView,
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneView }),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWorkspacePaneView).not.toHaveBeenCalled()
    expect(openViewsFor('feature/worktree')).toEqual([])
    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command restores the active worktree tab when runtime close fails', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'changes',
    })
    const closeWorkspacePaneView = vi.fn(async () => false)
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(),
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView,
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneView }),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWorkspacePaneView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
    expect(showRepoWorkspacePaneView).toHaveBeenNthCalledWith(1, REPO_ID, 'terminal')
    expect(showRepoWorkspacePaneView).toHaveBeenNthCalledWith(2, REPO_ID, 'changes')
    expect(preferredWorkspacePaneView()).toBe('changes')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command falls back to closing the window when no workspace tab is selected', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      openBranchWorkspacePaneViews: [],
    })
    const closeTerminalByDescriptor = vi.fn()
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  test('select workspace pane tab by index follows the mixed tab strip order', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const openWorkspacePaneView = vi.fn(async () => true)
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal,
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    const navigation = navigationWith({ showRepoWorkspacePaneView })

    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 2, navigation })).toBe(true)
    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 3, navigation })).toBe(true)

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
    expect(openWorkspacePaneView).not.toHaveBeenCalled()
  })

  test('move workspace pane tab command follows the mixed tab strip order', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'terminal-2'),
      selectTerminal,
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
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
      openBranchWorkspacePaneViews: ['status', 'history'],
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
  return repo ? branchWorkspacePaneViewsForBranch(repo.ui, branch) : []
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
    staticWorkspacePaneViews: [
      {
        type: 'changes',
        id: 'changes',
        key: 'changes',
        worktreeTerminalKey: WORKTREE_KEY,
        worktreePath: WORKTREE_PATH,
        displayOrder: 2,
      },
    ],
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
    workspacePaneViews: [
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
        type: 'changes',
        id: 'changes',
        key: 'changes',
        worktreeTerminalKey: WORKTREE_KEY,
        worktreePath: WORKTREE_PATH,
        displayOrder: 2,
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
    staticWorkspacePaneViews: [],
    sessions: [],
    workspacePaneViews: [],
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
    staticWorkspacePaneViews: [],
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
    workspacePaneViews: [
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
