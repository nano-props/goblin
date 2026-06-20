// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const REPO_ID = '/tmp/keyboard-repo'
const WORKTREE_PATH = '/tmp/keyboard-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

interface HookHostOptions {
  currentRepoId: string | null
  isWorkspaceShortcutSuppressed: () => boolean
  isSettingsOpen: () => boolean
  onExitSettings: () => void
  navigation: MainWindowNavigationActions
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  setTerminalSessionCommandBridge(null)
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('useKeyboard', () => {
  test('esc exits the settings route', async () => {
    const onExitSettings = vi.fn()
    await renderHookHost({
      isWorkspaceShortcutSuppressed: () => true,
      isSettingsOpen: () => true,
      onExitSettings,
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })

    expect(onExitSettings).toHaveBeenCalledTimes(1)
  })

  test('workspace pane view shortcuts move through currently opened workspace pane views', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      workspacePaneView: 'status',
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal,
      openWorkspacePaneView: vi.fn(async () => true),
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'terminal-1')
  })
})

async function renderHookHost(overrides: Partial<HookHostOptions> = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<HookHost {...overrides} />)
    await Promise.resolve()
  })
}

function HookHost(overrides: Partial<HookHostOptions>) {
  useKeyboard({
    navigation: overrides.navigation ?? navigationWith(),
    currentRepoId: overrides.currentRepoId ?? null,
    onShowHelp: () => {},
    isWorkspaceShortcutSuppressed: overrides.isWorkspaceShortcutSuppressed ?? (() => false),
    isSettingsOpen: overrides.isSettingsOpen ?? (() => false),
    onExitSettings: overrides.onExitSettings ?? (() => {}),
  })
  return null
}

function navigationWith(overrides: Partial<MainWindowNavigationActions> = {}): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneView: () => {},
    showRepoBranchWorkspacePaneView: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

function worktreeSnapshot(): WorktreeTerminalSnapshot {
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
