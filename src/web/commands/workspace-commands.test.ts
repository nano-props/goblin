// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runTerminalPrimaryActionCommand } from '#/web/commands/workspace-commands.ts'
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
  test('terminal primary action opens the terminal tab and creates the first terminal when missing', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'status',
    })
    const createTerminal = vi.fn(async () => 'terminal-1')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()
    const setDetailCollapsed = vi.fn((collapsed: boolean) => useReposStore.getState().setDetailCollapsed(collapsed))

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, navigation, setDetailCollapsed })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
    expect(useReposStore.getState().detailCollapsed).toBe(false)
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
      detailTab: 'status',
    })
    const createTerminal = vi.fn(async () => 'terminal-new')
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [
          {
            key: 'terminal-1',
            worktreeTerminalKey: WORKTREE_KEY,
            terminalId: 'terminal-1',
            index: 1,
            title: 'terminal 1',
            phase: 'open',
            selected: true,
            hasBell: false,
          },
          {
            key: 'terminal-2',
            worktreeTerminalKey: WORKTREE_KEY,
            terminalId: 'terminal-2',
            index: 2,
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
    })
    const navigation = navigationWith()
    const setDetailCollapsed = vi.fn((collapsed: boolean) => useReposStore.getState().setDetailCollapsed(collapsed))

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, navigation, setDetailCollapsed })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
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
    showRepoDetailTab: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setDetailTab(repoId, tab)
    },
    showRepoBranchDetailTab: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setDetailTab(repoId, tab)
    },
    openSettings: () => {},
  }
}
