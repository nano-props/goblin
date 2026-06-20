// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  runShowWorkspacePaneViewCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'

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
  test.each(['status', 'changes'] as const)(
    'show workspace pane view command opens the %s static view for the selected worktree',
    (tab) => {
      seedRepoState({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        selectedBranch: 'feature/worktree',
        workspacePaneView: 'terminal',
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
          pendingCreate: false,
        }),
        createTerminal: vi.fn(async () => 'terminal-1'),
        selectTerminal: vi.fn(),
        openWorkspacePaneView,
        closeWorkspacePaneView: vi.fn(async () => true),
        reorderWorkspacePaneViews: vi.fn(async () => true),
      })
      const navigation = navigationWith()

      expect(runShowWorkspacePaneViewCommand({ repoId: REPO_ID, tab, navigation })).toBe(true)

      expect(openWorkspacePaneView).toHaveBeenCalledWith(WORKTREE_KEY, tab)
      expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe(tab)
    },
  )

  test('terminal primary action opens the terminal view and creates the first terminal when missing', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      workspacePaneView: 'status',
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

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('terminal')
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
      workspacePaneView: 'status',
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

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('terminal')
    expect(createTerminal).not.toHaveBeenCalled()
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
  })
})

function navigationWith(): MainWindowNavigationActions {
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
  }
}
