// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  observedPrimaryWindowNavigationActionsForTest,
  observedWorkspacePaneRouteForTarget,
  seedInitialObservedWorkspacePaneRouteForTest,
  type PrimaryWindowNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { setTerminalSessionCommandBridgeWithCreatedAdmissionForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalFilesystemTargetSnapshot, TerminalFocusRequest } from '#/web/components/terminal/types.ts'
import { terminalDescriptorForTest, terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import { repoOperationsQueryKey } from '#/web/repo-query-keys.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  beginPrimaryWindowNavigation,
  resetPrimaryWindowNavigationForTest,
} from '#/web/primary-window-navigation-lifecycle.ts'
import { claimTerminalAutoFocus, resetTerminalAutoFocusForTest } from '#/web/terminal-focus.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const branchShortcutMocks = vi.hoisted(() => ({
  runBranchActionShortcut: vi.fn(),
}))

vi.mock('#/web/keyboard/branch-action-shortcuts.ts', () => ({
  runBranchActionShortcut: branchShortcutMocks.runBranchActionShortcut,
}))

const testWindow = window as unknown as { goblinNative?: Window['goblinNative'] }
const REPO_ID = workspaceIdForTest('goblin+file:///tmp/keyboard-repo')
const REPO_PATH = '/tmp/keyboard-repo'
const WORKTREE_PATH = '/tmp/keyboard-worktree'
const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
const FILESYSTEM_CAPABILITIES = {
  files: { read: true, write: true },
  terminal: { available: true },
  git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
} as const

interface HookHostOptions {
  currentWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  isWorkspaceShortcutSuppressed: () => boolean
  isSettingsOpen: () => boolean
  onExitSettings: () => void
  openCreateWorktree: () => void
  navigation: PrimaryWindowNavigationActions
}

beforeEach(() => {
  resetTerminalAutoFocusForTest()
  resetPrimaryWindowNavigationForTest()
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
})

afterEach(() => {
  resetTerminalAutoFocusForTest()
  resetPrimaryWindowNavigationForTest()
  setTerminalSessionCommandBridge(null)
  delete testWindow.goblinNative
  document.body.replaceChildren()
})

describe('useKeyboard', () => {
  test('does not dispatch bare branch shortcuts while an xterm owns keyboard focus', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    await renderHookHost({ currentWorkspaceId: REPO_ID, currentBranchName: 'feature/worktree' })
    const host = document.createElement('div')
    host.className = 'goblin-managed-terminal-host'
    const textarea = document.createElement('textarea')
    host.appendChild(textarea)
    document.body.appendChild(host)
    textarea.focus()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }))
      await Promise.resolve()
    })

    expect(branchShortcutMocks.runBranchActionShortcut).not.toHaveBeenCalled()
  })

  test('does not suppress a later workspace shortcut while automatic terminal focus is pending', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    await renderHookHost({ currentWorkspaceId: REPO_ID, currentBranchName: 'feature/worktree' })
    const lease = claimTerminalAutoFocus(beginPrimaryWindowNavigation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const keydown = new KeyboardEvent('keydown', {
      key: 'p',
      code: 'KeyP',
      bubbles: true,
      cancelable: true,
    })
    await Promise.resolve()

    await act(async () => {
      document.body.dispatchEvent(keydown)
      await Promise.resolve()
    })

    expect(branchShortcutMocks.runBranchActionShortcut).toHaveBeenCalledOnce()
  })

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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn()
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal,
      focusTerminal: vi.fn(() => false),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(selectTerminal).not.toHaveBeenCalled()
  })

  test('workspace pane tab shortcuts move through branch tabs without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(repoId, branch, tab)
      return true
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/no-worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      branchName: 'feature/no-worktree',
      worktreePath: null,
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'history')
  })

  test('branch navigation shortcuts use the React Query projection read model for branch order', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'main',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('main'), createRepoBranch('feature/query')],
      currentBranch: 'main',
    })
    const selectRepoBranch = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'main',
      navigation: navigationWith({ selectRepoBranch }),
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }))
      await Promise.resolve()
    })

    expect(selectRepoBranch).toHaveBeenCalledWith(REPO_ID, 'feature/query')
  })

  test('alt-arrow navigates workspace history', async () => {
    const goBack = vi.fn()
    const goForward = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      navigation: navigationWith({ goBack, goForward }),
    })

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, bubbles: true }),
      )
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true, bubbles: true }),
      )
      await Promise.resolve()
    })

    expect(goBack).toHaveBeenCalledWith(REPO_ID)
    expect(goForward).toHaveBeenCalledWith(REPO_ID)
  })

  test('primary modifier plus number selects workspace pane tabs even while terminal is focused', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn()
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal,
      focusTerminal: vi.fn(() => false),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'status' },
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

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(selectTerminal).not.toHaveBeenCalled()
    terminalHost.remove()
  })

  test('primary modifier plus t dispatches every keydown event including autorepeat', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: {
        routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/worktree' },
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        filesystemTarget: gitWorktreePaneFilesystemTarget({
          workspaceId: REPO_ID,
          workspaceRuntimeId: workspaceRuntimeIdForTest(),
          worktreePath: WORKTREE_PATH,
          head: { kind: 'branch', branchName: 'feature/worktree' },
          capabilities: FILESYSTEM_CAPABILITIES,
        }),
      },
    })

    const initialShortcut = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const repeatedShortcut = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      window.dispatchEvent(initialShortcut)
      window.dispatchEvent(repeatedShortcut)
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(2))
    expect(initialShortcut.defaultPrevented).toBe(true)
    expect(repeatedShortcut.defaultPrevented).toBe(true)
  })

  test('dispatches Ctrl+T without waiting for the initiating key to be released', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    const focusTerminal = vi.fn((_terminalSessionId: string, _request?: TerminalFocusRequest) => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
      focusTerminal,
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: {
        routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/worktree' },
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        filesystemTarget: gitWorktreePaneFilesystemTarget({
          workspaceId: REPO_ID,
          workspaceRuntimeId: workspaceRuntimeIdForTest(),
          worktreePath: WORKTREE_PATH,
          head: { kind: 'branch', branchName: 'feature/worktree' },
          capabilities: FILESYSTEM_CAPABILITIES,
        }),
      },
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    })
    const shortcut = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }),
      )
      document.body.dispatchEvent(shortcut)
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(observedWorkspacePaneRouteForTarget(REPO_ID, 'feature/worktree')).toEqual({
        kind: 'terminal',
        terminalSessionId: 'term-222222222222222222222',
      }),
    )

    expect(shortcut.defaultPrevented).toBe(true)
    expect(createTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(focusTerminal.mock.calls[0]![1]?.isCurrent()).toBe(true)
    focusTerminal.mock.calls[0]![1]?.onSettled?.()
  })

  test('primary modifier plus t creates a terminal for a workspace root target', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: null,
      workspaceProbe: {
        status: 'ready',
        name: 'plain-workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: (terminalFilesystemTargetKey) => ({
        terminalFilesystemTargetKey,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: null,
      currentWorkspacePaneCommandTarget: {
        routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        workspacePaneRoute: null,
        filesystemTarget: workspaceRootPaneFilesystemTarget({
          workspaceId: REPO_ID,
          workspaceRuntimeId: workspaceRuntimeIdForTest(),
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
        }),
      },
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).toHaveBeenCalledWith(
      terminalSessionBaseForTest({
        repoRoot: REPO_ID,
        workspaceRuntimeId: workspaceRuntimeIdForTest(),
        branch: null,
        worktreePath: REPO_PATH,
      }),
      undefined,
    )
  })

  test('primary modifier plus n opens the create worktree dialog', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus n no-ops when there is no current repo', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: null, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus n does not open create worktree while workspace shortcuts are suppressed', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree, isWorkspaceShortcutSuppressed: () => true })

    const shortcut = new KeyboardEvent('keydown', {
      key: 'n',
      code: 'KeyN',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      window.dispatchEvent(shortcut)
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(shortcut.defaultPrevented).toBe(true)
  })

  test('does not consume unowned primary-modifier combinations', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    await renderHookHost()
    const copy = new KeyboardEvent('keydown', {
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })

    await act(async () => {
      document.body.dispatchEvent(copy)
      await Promise.resolve()
    })

    expect(copy.defaultPrevented).toBe(false)
  })

  test('primary modifier plus n does not open create worktree while a branch action is busy', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    useWorkspacesStore.setState((state) => {
      const repo = state.workspaces[REPO_ID]
      if (repo?.capability.kind !== 'git') return state
      const branchAction = {
        ...repo.capability.git.operations.branchAction,
        phase: 'running' as const,
        reason: 'branch:createWorktree' as const,
        target: 'feature/worktree',
      }
      const operations = { ...repo.capability.git.operations, branchAction }
      return {
        workspaces: {
          ...state.workspaces,
          [REPO_ID]: {
            ...repo,
            capability: { ...repo.capability, git: { ...repo.capability.git, operations } },
          },
        },
      }
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('primary modifier plus n reads busy state from server operations projection', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('primary modifier plus n does not project retained operations after a canonical read error', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const queryKey = repoOperationsQueryKey(REPO_ID, repo.workspaceRuntimeId)
    const query = primaryWindowQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing operations query')
    query.setState({ ...query.state, status: 'error', error: new Error('error.repository-boundary-unavailable') })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(openCreateWorktree).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('does not run menu-backed primary shortcuts from the client in electron', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const openCreateWorktree = vi.fn()
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

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

  test('does not dispatch workspace-pane shortcuts from the dashboard route', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    await renderHookHost({ currentWorkspaceId: REPO_ID, currentWorkspacePaneCommandTarget: null })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
  })

  test('primary modifier plus w closes the selected terminal tab', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: {
        routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/worktree' },
        filesystemTarget: gitWorktreePaneFilesystemTarget({
          workspaceId: REPO_ID,
          workspaceRuntimeId: workspaceRuntimeIdForTest(),
          worktreePath: WORKTREE_PATH,
          head: { kind: 'branch', branchName: 'feature/worktree' },
          capabilities: FILESYSTEM_CAPABILITIES,
        }),
        workspacePaneRoute: {
          kind: 'terminal',
          terminalSessionId: 'term-111111111111111111111',
        },
      },
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith(
      'term-111111111111111111111',
      terminalSessionBaseForTest({
        repoRoot: REPO_ID,
        workspaceRuntimeId: workspaceRuntimeIdForTest(),
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    )

    const repeatedClose = new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      window.dispatchEvent(repeatedClose)
      await Promise.resolve()
    })

    expect(repeatedClose.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(closeTerminalByDescriptor).toHaveBeenCalledTimes(2))

    const secondClose = new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      document.body.dispatchEvent(secondClose)
      await Promise.resolve()
    })

    expect(secondClose.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(closeTerminalByDescriptor).toHaveBeenCalledTimes(3))
  })
})

function renderHookHost(overrides: Partial<HookHostOptions> = {}) {
  return renderInJsdom(<HookHost {...overrides} />)
}

function serverOperation(
  workspaceRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    workspaceRuntimeId,
    kind: overrides.kind,
    phase: overrides.phase,
    source: 'user',
    target: null,
    queuedAt: 100,
    startedAt: overrides.phase === 'queued' ? null : 101,
    deadlineAt: null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: true,
  }
}

function HookHost(overrides: Partial<HookHostOptions>) {
  const repo = overrides.currentWorkspaceId
    ? useWorkspacesStore.getState().workspaces[overrides.currentWorkspaceId]
    : null
  const branch =
    repo && overrides.currentBranchName
      ? readRepoBranchSnapshotQueryProjection(repo)?.branches.find(
          (candidate) => candidate.name === overrides.currentBranchName,
        )
      : null
  const defaultCommandTarget =
    repo?.capability.kind === 'git' && overrides.currentBranchName && branch?.worktree
      ? {
          routeTarget: {
            kind: 'git-branch' as const,
            workspaceId: repo.id,
            branchName: overrides.currentBranchName,
          },
          workspacePaneRoute: null,
          filesystemTarget: gitWorktreePaneFilesystemTarget({
            workspaceId: repo.id,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            worktreePath: branch.worktree.path,
            head: { kind: 'branch' as const, branchName: overrides.currentBranchName },
            capabilities: repo.capability.probe.capabilities,
          }),
        }
      : overrides.currentBranchName
        ? {
            routeTarget: {
              kind: 'git-branch' as const,
              workspaceId: repo?.id ?? REPO_ID,
              branchName: overrides.currentBranchName,
            },
            workspacePaneRoute: null,
            filesystemTarget: null,
          }
        : null
  useKeyboard({
    navigation: overrides.navigation ?? navigationWith(),
    currentWorkspaceId: overrides.currentWorkspaceId ?? null,
    currentBranchName: overrides.currentBranchName ?? null,
    currentWorkspacePaneCommandTarget: overrides.currentWorkspacePaneCommandTarget ?? defaultCommandTarget,
    onShowHelp: () => {},
    isWorkspaceShortcutSuppressed: overrides.isWorkspaceShortcutSuppressed ?? (() => false),
    isSettingsOpen: overrides.isSettingsOpen ?? (() => false),
    onExitSettings: overrides.onExitSettings ?? (() => {}),
    openCreateWorktree: overrides.openCreateWorktree ?? (() => {}),
  })
  return null
}

function navigationWith(overrides: PrimaryWindowNavigationOverridesForTest = {}): PrimaryWindowNavigationActions {
  return observedPrimaryWindowNavigationActionsForTest({
    currentWorkspacePaneRoute: observedWorkspacePaneRouteForTarget,
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  })
}

function workspaceRuntimeIdForTest(): string {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  if (!repo) throw new Error(`expected seeded repo ${REPO_ID}`)
  return repo.workspaceRuntimeId
}

function installNativeBridgeStub() {
  testWindow.goblinNative = currentNativeBridge({
    invokeIpc: vi.fn(async () => null),
    abortIpc: vi.fn(async () => false),
    onEvent: vi.fn(() => () => {}),
    onIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    terminal: {
      notifyBell: async () => true,
      sendTestNotification: async () => true,
      setBadge: () => {},
    },
  })
}

function terminalFilesystemTargetSnapshot(): TerminalFilesystemTargetSnapshot {
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: terminalDescriptorForTest({
      terminalSessionId: 'term-111111111111111111111',
      index: 1,
      repoRoot: REPO_ID,

      workspaceRuntimeId: workspaceRuntimeIdForTest(),

      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    }),
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'term-111111111111111111111',
        terminalFilesystemTargetKey: WORKTREE_KEY,
        index: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ],
    count: 1,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}
