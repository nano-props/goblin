// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setTerminalSlotCommandBridge } from '#/web/components/terminal/terminal-slot-command-bridge.ts'
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
  setTerminalSlotCommandBridge(null)
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

  test('workspace pane view shortcuts move through currently opened workspace pane views', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn()
    setTerminalSlotCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'slot-1'),
      selectTerminal,
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
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'slot-1')
  })

  test('workspace pane view shortcuts move through branch tabs without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/no-worktree': [
          workspacePaneStaticTabOrderEntry('status'),
          workspacePaneStaticTabOrderEntry('history'),
        ],
      },
    })
    const showRepoWorkspacePaneView = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneView(repoId, tab)
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneView }),
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'history')
  })

  test('primary modifier plus number selects workspace pane tabs even while terminal is focused', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneView = vi.fn()
    setTerminalSlotCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'slot-1'),
      selectTerminal,
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneView }),
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

    expect(showRepoWorkspacePaneView).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'slot-1')
    terminalHost.remove()
  })

  test('does not run menu-backed primary shortcuts from the renderer in electron', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const createTerminal = vi.fn(async () => 'slot-2')
    const closeTerminalByDescriptor = vi.fn()
    setTerminalSlotCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentRepoId: REPO_ID })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
  })

  test('primary modifier plus w closes the selected terminal tab', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const closeTerminalByDescriptor = vi.fn()
    setTerminalSlotCommandBridge({
      worktreeSnapshot: () => worktreeSnapshot(),
      createTerminal: vi.fn(async () => 'slot-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentRepoId: REPO_ID })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('slot-1', {
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
      key: 'slot-1',
      worktreeTerminalKey: WORKTREE_KEY,
      slotId: 'slot-1',
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        id: 'slot-1',
        key: 'slot-1',
        worktreeTerminalKey: WORKTREE_KEY,
        slotId: 'slot-1',
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
