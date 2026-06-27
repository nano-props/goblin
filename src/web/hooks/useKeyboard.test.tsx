// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const testWindow = window as unknown as { goblinNative?: Window['goblinNative'] }
const REPO_ID = '/tmp/keyboard-repo'
const WORKTREE_PATH = '/tmp/keyboard-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

interface HookHostOptions {
  currentRepoId: string | null
  isWorkspaceShortcutSuppressed: () => boolean
  isSettingsOpen: () => boolean
  onExitSettings: () => void
  openCreateWorktree: () => void
  navigation: PrimaryWindowNavigationActions
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
  delete testWindow.goblinNative
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

  test('workspace pane tab shortcuts move through currently opened workspace pane tabs', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal,
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('workspace pane tab shortcuts move through branch tabs without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/no-worktree': [
          workspacePaneStaticTabOrderEntry('status'),
          workspacePaneStaticTabOrderEntry('history'),
        ],
      },
    })
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'history')
  })

  test('primary modifier plus number selects workspace pane tabs even while terminal is focused', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal,
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
    })
    const terminalHost = document.createElement('div')
    terminalHost.className = 'goblin-managed-terminal-host'
    terminalHost.tabIndex = -1
    document.body.append(terminalHost)
    terminalHost.focus()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
    terminalHost.remove()
  })

  test('primary modifier plus t creates a new terminal tab', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const createTerminal = vi.fn(async () => 'session-2')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    await renderHookHost({ currentRepoId: REPO_ID })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).toHaveBeenCalledTimes(1)
  })

  test('primary modifier plus n opens the create worktree dialog', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentRepoId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus n no-ops when there is no active repo', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentRepoId: null, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus n does not open create worktree while workspace shortcuts are suppressed', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentRepoId: REPO_ID, openCreateWorktree, isWorkspaceShortcutSuppressed: () => true })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
  })

  test('primary modifier plus n does not open create worktree while a branch action is busy', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
    })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      return {
        repos: {
          ...state.repos,
          [REPO_ID]: {
            ...repo,
            operations: {
              ...repo.operations,
              branchAction: {
                ...repo.operations.branchAction,
                phase: 'running',
                reason: 'branch:createWorktree',
                target: 'feature/worktree',
              },
            },
          },
        },
      }
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentRepoId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('does not run menu-backed primary shortcuts from the client in electron', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const createTerminal = vi.fn(async () => 'session-2')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const openCreateWorktree = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentRepoId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus w closes the selected terminal tab', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentRepoId: REPO_ID })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
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
    openCreateWorktree: overrides.openCreateWorktree ?? (() => {}),
  })
  return null
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneTab: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

function installNativeBridgeStub() {
  testWindow.goblinNative = {
    invokeIpc: vi.fn(async () => null),
    abortIpc: vi.fn(async () => false),
    onEvent: vi.fn(() => () => {}),
    onIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    terminal: {},
    saveClipboardFiles: vi.fn(async () => []),
  }
}

function worktreeSnapshot(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: {
      key: 'session-1',
      worktreeTerminalKey: WORKTREE_KEY,
      sessionId: 'session-1',
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        id: 'session-1',
        key: 'session-1',
        worktreeTerminalKey: WORKTREE_KEY,
        sessionId: 'session-1',
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
