// @vitest-environment jsdom

import {
  createRepoWorktreeSnapshotForTest,
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))
import {
  observedAppNavigationActionsForTest,
  observedWorkspacePaneRouteForTarget,
  seedInitialObservedWorkspacePaneRouteForTest,
  type AppNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { getRepoSnapshotQueryData, setRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type {
  TerminalCreateOptions,
  TerminalFilesystemTargetSnapshot,
  TerminalFocusRequest,
} from '#/web/components/terminal/types.ts'
import { terminalDescriptorForTest, terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'
import { keyboardEventForTest } from '#/web/test-utils/keyboard-event.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { setRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import { repoOperationsQueryKey, repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitWorkspaceNavigatorRowIdentity } from '#/web/components/workspace-navigator/git-workspace-navigator-model.ts'
import { beginAppNavigation, resetAppNavigationForTest } from '#/web/app-navigation-lifecycle.ts'
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
  currentGitWorkspaceNavigatorRowIdentity: GitWorkspaceNavigatorRowIdentity | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  isWorkspaceShortcutSuppressed: () => boolean
  isSettingsOpen: () => boolean
  onExitSettings: () => void
  openCreateWorktree: () => void
  navigation: AppNavigationActions
}

beforeEach(() => {
  resetTerminalAutoFocusForTest()
  resetAppNavigationForTest()
  appQueryClient.clear()
  resetWorkspacesStore()
})

afterEach(() => {
  resetTerminalAutoFocusForTest()
  resetAppNavigationForTest()
  setTerminalSessionCommandBridge(null)
  delete testWindow.goblinNative
  document.body.replaceChildren()
})

describe('useKeyboard', () => {
  test('does not dispatch bare branch shortcuts while an xterm owns keyboard focus', async () => {
    seedCurrentWorktreeRepoForTest()
    await renderHookHost({ currentWorkspaceId: REPO_ID, currentBranchName: 'feature/worktree' })
    const host = document.createElement('div')
    host.className = 'goblin-managed-terminal-host'
    const textarea = document.createElement('textarea')
    host.appendChild(textarea)
    document.body.appendChild(host)
    textarea.focus()

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'p', code: 'KeyP' }))
      await Promise.resolve()
    })

    expect(branchShortcutMocks.runBranchActionShortcut).not.toHaveBeenCalled()
  })

  test('does not suppress a later workspace shortcut while automatic terminal focus is pending', async () => {
    seedCurrentWorktreeRepoForTest()
    await renderHookHost({ currentWorkspaceId: REPO_ID, currentBranchName: 'feature/worktree' })
    const lease = claimTerminalAutoFocus(beginAppNavigation())
    if (!lease) throw new Error('expected terminal automatic-focus lease')
    const keydown = keyboardEventForTest('keydown', {
      key: 'p',
      code: 'KeyP',
      bubbles: true,
      cancelable: true,
    })
    await Promise.resolve()

    await flushTestUpdates(async () => {
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

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(onExitSettings).toHaveBeenCalledTimes(1)
  })

  test('workspace pane tab shortcuts move through currently opened workspace pane tabs', async () => {
    seedTabbedWorktreeRepoForTest('status')
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn()
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal,
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'status' },
    })

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'ArrowRight' }))
      await Promise.resolve()
    })

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      }),
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.any(Object),
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
      workspacesStore.getState().setWorkspacePaneTab(repoId, branch, tab)
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

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'ArrowRight' }))
      await Promise.resolve()
    })

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'history')
  })

  test('branch navigation shortcuts use accepted snapshot data after a background refresh failure', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'main',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('main'), createRepoBranch('feature/query')],
      currentBranch: 'main',
    })
    const queryKey = repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing snapshot query')
    query.setState({ ...query.state, status: 'error', error: new Error('snapshot unavailable') })
    const selectRepoBranch = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'main',
      navigation: navigationWith({ selectRepoBranch }),
    })

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'j', code: 'KeyJ' }))
      await Promise.resolve()
    })

    expect(selectRepoBranch).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/query' },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
  })

  test('branch navigation traverses the rendered targets across attached, rebase, and detached states', async () => {
    const currentBranch = createRepoBranch('feature/current')
    const nextBranch = createRepoBranch('feature/next')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [currentBranch, nextBranch],
      currentBranchName: currentBranch.name,
      worktrees: [createRepoWorktreeSnapshotForTest(currentBranch.name, WORKTREE_PATH)],
    })
    const selectRepoBranch = vi.fn()
    const selectRepoWorktree = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: currentBranch.name,
      currentGitWorkspaceNavigatorRowIdentity: { kind: 'worktree', worktreePath: WORKTREE_PATH },
      navigation: navigationWith({ selectRepoBranch, selectRepoWorktree }),
    })

    await dispatchBranchShortcut('j', 'KeyJ')
    expect(selectRepoBranch).toHaveBeenCalledOnce()
    expect(selectRepoBranch).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: nextBranch.name },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
    selectRepoBranch.mockClear()

    const attachedSnapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
    if (!attachedSnapshot) throw new Error('expected attached snapshot')
    setRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId, {
      ...attachedSnapshot,
      worktrees: attachedSnapshot.worktrees.map((worktree) => ({
        ...worktree,
        head: { kind: 'detached' as const },
        operation: { kind: 'rebase' as const },
      })),
    })

    await dispatchBranchShortcut('j', 'KeyJ')
    expect(selectRepoBranch).toHaveBeenCalledOnce()
    expect(selectRepoBranch).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: nextBranch.name },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
    selectRepoBranch.mockClear()

    const rebaseSnapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
    if (!rebaseSnapshot) throw new Error('expected rebase snapshot')
    setRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId, {
      ...rebaseSnapshot,
      worktrees: rebaseSnapshot.worktrees.map((worktree) => ({
        ...worktree,
        operation: null,
        materializedBranch: null,
      })),
    })

    await dispatchBranchShortcut('k', 'KeyK')
    expect(selectRepoBranch).toHaveBeenCalledOnce()
    expect(selectRepoBranch).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: nextBranch.name },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
    expect(selectRepoWorktree).not.toHaveBeenCalled()
  })

  test('branch navigation fast-fails when the authoritative snapshot is unavailable', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/next')],
      currentBranchName: 'main',
    })
    appQueryClient.removeQueries({ queryKey: repoSnapshotQueryKey(repo.id, repo.workspaceRuntimeId), exact: true })
    const selectRepoBranch = vi.fn()
    const selectRepoWorktree = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'main',
      navigation: navigationWith({ selectRepoBranch, selectRepoWorktree }),
    })

    const shortcut = await dispatchBranchShortcut('j', 'KeyJ')

    expect(shortcut.defaultPrevented).toBe(false)
    expect(selectRepoBranch).not.toHaveBeenCalled()
    expect(selectRepoWorktree).not.toHaveBeenCalled()
  })

  test('branch navigation selects a detached worktree with its runtime lease', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
      worktrees: [
        {
          path: WORKTREE_PATH,
          head: { kind: 'detached' },
          headOid: '0123456789abcdef0123456789abcdef01234567',
          operation: null,
          materializedBranch: null,
          isPrimary: false,
          isLocked: false,
        },
      ],
    })
    const selectRepoBranch = vi.fn()
    const selectRepoWorktree = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'main',
      currentGitWorkspaceNavigatorRowIdentity: { kind: 'branch', branchName: 'main' },
      navigation: navigationWith({ selectRepoBranch, selectRepoWorktree }),
    })

    await dispatchBranchShortcut('j', 'KeyJ')

    expect(selectRepoWorktree).toHaveBeenCalledOnce()
    expect(selectRepoWorktree).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
    expect(selectRepoBranch).not.toHaveBeenCalled()
  })

  test('alt-arrow navigates workspace history', async () => {
    const goBack = vi.fn()
    const goForward = vi.fn()
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      navigation: navigationWith({ goBack, goForward }),
    })

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }))
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'ArrowRight', code: 'ArrowRight', altKey: true }))
      await Promise.resolve()
    })

    expect(goBack).toHaveBeenCalledWith(REPO_ID)
    expect(goForward).toHaveBeenCalledWith(REPO_ID)
  })

  test('command-bracket navigates workspace history on macOS', async () => {
    const originalPlatform = window.navigator.platform
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })
    const goBack = vi.fn()
    const goForward = vi.fn()
    try {
      await renderHookHost({
        currentWorkspaceId: REPO_ID,
        navigation: navigationWith({ goBack, goForward }),
      })

      await flushTestUpdates(async () => {
        window.dispatchEvent(keyboardEventForTest('keydown', { key: '[', code: 'BracketLeft', metaKey: true }))
        window.dispatchEvent(keyboardEventForTest('keydown', { key: ']', code: 'BracketRight', metaKey: true }))
        await Promise.resolve()
      })

      expect(goBack).toHaveBeenCalledWith(REPO_ID)
      expect(goForward).toHaveBeenCalledWith(REPO_ID)
    } finally {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value: originalPlatform })
    }
  })

  test('primary modifier plus number selects workspace pane tabs even while terminal is focused', async () => {
    installNativeBridgeStub()
    seedTabbedWorktreeRepoForTest('status')
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn()
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal,
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitFilesystemWorkspacePaneRoute,
      }),
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

    await dispatchPrimaryShortcut('2', 'Digit2')

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      }),
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.any(Object),
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(selectTerminal).not.toHaveBeenCalled()
    terminalHost.remove()
  })

  test('primary modifier plus t dispatches every keydown event including autorepeat', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedTabbedWorktreeRepoForTest('terminal')
    const createTerminal = vi.fn(async (_base: unknown, _options?: TerminalCreateOptions) =>
      Promise.resolve('term-222222222222222222222'),
    )
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      createTerminalWithAdmission: vi.fn(async (base, options) => ({
        terminalSessionId: await createTerminal(base, options),
        presentation: base.presentation,
        requestRole: 'leader' as const,
        resourceDisposition: 'created' as const,
        runtimeProjectionApplied: true,
      })),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: currentTerminalPaneCommandTargetForTest(),
    })

    const initialShortcut = keyboardEventForTest('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const repeatedShortcut = keyboardEventForTest('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    await flushTestUpdates(async () => {
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
    seedTabbedWorktreeRepoForTest('terminal')
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    const focusTerminal = vi.fn((_terminalSessionId: string, _request?: TerminalFocusRequest) => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      createTerminalWithAdmission: vi.fn(async (base) => ({
        terminalSessionId: await createTerminal(),
        presentation: base.presentation,
        requestRole: 'leader' as const,
        resourceDisposition: 'created' as const,
        runtimeProjectionApplied: true,
      })),
      selectTerminal: vi.fn(),
      focusTerminal,
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: currentTerminalPaneCommandTargetForTest(),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    })
    const shortcut = keyboardEventForTest('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await flushTestUpdates(async () => {
      document.body.dispatchEvent(
        keyboardEventForTest('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true }),
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
    await vi.waitFor(() => expect(focusTerminal).toHaveBeenCalledOnce())
    expect(focusTerminal.mock.calls[0]![1]?.isCurrent()).toBe(true)
    focusTerminal.mock.calls[0]![1]?.onSettled?.()
  })

  test('primary modifier plus t creates a terminal for a workspace root target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: null,
      workspaceProbe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })
    const createTerminal = vi.fn(async (_base: unknown, _options?: TerminalCreateOptions) =>
      Promise.resolve('term-222222222222222222222'),
    )
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
      createTerminalWithAdmission: vi.fn(async (base, options) => ({
        terminalSessionId: await createTerminal(base, options),
        presentation: base.presentation,
        requestRole: 'leader' as const,
        resourceDisposition: 'created' as const,
        runtimeProjectionApplied: true,
      })),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: null,
      currentWorkspacePaneCommandTarget: {
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

    await dispatchPrimaryShortcut('t', 'KeyT')

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
    seedCurrentWorktreeRepoForTest()
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await dispatchPrimaryShortcut('n', 'KeyN')

    expect(openCreateWorktree).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus n no-ops when there is no current repo', async () => {
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: null, openCreateWorktree })

    await dispatchPrimaryShortcut('n', 'KeyN')

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('primary modifier plus n does not open create worktree while workspace shortcuts are suppressed', async () => {
    seedCurrentWorktreeRepoForTest()
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree, isWorkspaceShortcutSuppressed: () => true })

    const shortcut = await dispatchPrimaryShortcut('n', 'KeyN', { cancelable: true })

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(shortcut.defaultPrevented).toBe(true)
  })

  test('does not consume unowned primary-modifier combinations', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    await renderHookHost()
    const copy = keyboardEventForTest('keydown', {
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })

    await flushTestUpdates(async () => {
      document.body.dispatchEvent(copy)
      await Promise.resolve()
    })

    expect(copy.defaultPrevented).toBe(false)
  })

  test('primary modifier plus n does not open create worktree while a branch action is busy', async () => {
    seedCurrentWorktreeRepoForTest()
    workspacesStore.setState((state) => {
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

    await dispatchPrimaryShortcut('n', 'KeyN')

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('primary modifier plus n reads busy state from server operations projection', async () => {
    const repo = seedCurrentWorktreeRepoForTest()
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await dispatchPrimaryShortcut('n', 'KeyN')

    expect(openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('primary modifier plus n does not project retained operations after a canonical read error', async () => {
    const repo = seedCurrentWorktreeRepoForTest()
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const queryKey = repoOperationsQueryKey(REPO_ID, repo.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing operations query')
    query.setState({ ...query.state, status: 'error', error: new Error('error.repository-boundary-unavailable') })
    const openCreateWorktree = vi.fn()
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await dispatchPrimaryShortcut('n', 'KeyN')

    expect(openCreateWorktree).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('does not run menu-backed primary shortcuts from the client in electron', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    installNativeBridgeStub()
    seedTabbedWorktreeRepoForTest('terminal')
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    const closeTerminalByDescriptor = vi.fn(async () => ({
      kind: 'committed' as const,
      projection: 'applied' as const,
    }))
    const openCreateWorktree = vi.fn()
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentWorkspaceId: REPO_ID, openCreateWorktree })

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 't', code: 'KeyT', ctrlKey: true }))
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'n', code: 'KeyN', ctrlKey: true }))
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'w', code: 'KeyW', ctrlKey: true }))
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
    const closeTerminalByDescriptor = vi.fn(async () => ({
      kind: 'committed' as const,
      projection: 'applied' as const,
    }))
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal,
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor,
    })

    await renderHookHost({ currentWorkspaceId: REPO_ID, currentWorkspacePaneCommandTarget: null })

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 't', code: 'KeyT', ctrlKey: true }))
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'w', code: 'KeyW', ctrlKey: true }))
      window.dispatchEvent(keyboardEventForTest('keydown', { key: '1', code: 'Digit1', ctrlKey: true }))
      await Promise.resolve()
    })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
  })

  test('primary modifier plus w closes the selected terminal tab', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedTabbedWorktreeRepoForTest('terminal')
    const closeTerminalByDescriptor = vi.fn(async () => ({
      kind: 'committed' as const,
      projection: 'applied' as const,
    }))
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor,
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: currentTerminalPaneCommandTargetForTest(),
    })

    await flushTestUpdates(async () => {
      window.dispatchEvent(keyboardEventForTest('keydown', { key: 'w', code: 'KeyW', ctrlKey: true }))
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

    const repeatedClose = keyboardEventForTest('keydown', {
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    await flushTestUpdates(async () => {
      window.dispatchEvent(repeatedClose)
      await Promise.resolve()
    })

    expect(repeatedClose.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(closeTerminalByDescriptor).toHaveBeenCalledTimes(2))

    const secondClose = keyboardEventForTest('keydown', {
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await flushTestUpdates(async () => {
      document.body.dispatchEvent(keyboardEventForTest('keyup', { key: 'w', code: 'KeyW', ctrlKey: true }))
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

function seedCurrentWorktreeRepoForTest() {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree')],
    worktrees: [
      createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH, { isPrimary: false, isLocked: false }),
    ],
    currentBranchName: 'feature/worktree',
  })
}

function seedTabbedWorktreeRepoForTest(preferredWorkspacePaneTab: 'status' | 'terminal') {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree')],
    worktrees: [
      createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH, { isPrimary: false, isLocked: false }),
    ],
    currentBranchName: 'feature/worktree',
    preferredWorkspacePaneTab,
    workspacePaneTabsByBranch: {
      'feature/worktree': [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
      ],
    },
  })
}

function currentTerminalPaneCommandTargetForTest(): WorkspacePaneCommandTarget {
  return {
    workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    filesystemTarget: gitWorktreePaneFilesystemTarget({
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      worktreePath: WORKTREE_PATH,
      head: { kind: 'branch', branchName: 'feature/worktree' },
      capabilities: FILESYSTEM_CAPABILITIES,
    }),
  }
}

async function dispatchBranchShortcut(key: string, code: string): Promise<KeyboardEvent> {
  const shortcut = keyboardEventForTest('keydown', { key, code })
  await flushTestUpdates(async () => {
    window.dispatchEvent(shortcut)
    await Promise.resolve()
  })
  return shortcut
}

async function dispatchPrimaryShortcut(
  key: string,
  code: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
  const shortcut = keyboardEventForTest('keydown', { ...init, key, code, ctrlKey: true })
  await flushTestUpdates(async () => {
    window.dispatchEvent(shortcut)
    await Promise.resolve()
  })
  return shortcut
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

const HookHost = defineComponent<Partial<HookHostOptions>>({
  name: 'KeyboardTestHost',
  props: [
    'currentWorkspaceId',
    'currentBranchName',
    'currentGitWorkspaceNavigatorRowIdentity',
    'currentWorkspacePaneCommandTarget',
    'isWorkspaceShortcutSuppressed',
    'isSettingsOpen',
    'onExitSettings',
    'openCreateWorktree',
    'navigation',
  ],

  setup(overrides) {
    const repo = overrides.currentWorkspaceId
      ? workspacesStore.getState().workspaces[overrides.currentWorkspaceId]
      : null
    const branch =
      repo && overrides.currentBranchName
        ? getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.branches.find(
            (candidate) => candidate.name === overrides.currentBranchName,
          )
        : null
    const snapshot = repo ? getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId) : null
    const worktree = snapshot && branch ? repoWorktreeForBranch(snapshot.worktrees, branch.name) : undefined
    const defaultCommandTarget =
      repo?.capability.kind === 'git' && overrides.currentBranchName && worktree
        ? {
            workspacePaneRoute: null,
            filesystemTarget: gitWorktreePaneFilesystemTarget({
              workspaceId: repo.id,
              workspaceRuntimeId: repo.workspaceRuntimeId,
              worktreePath: worktree.path,
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
              workspaceRuntimeId: repo?.workspaceRuntimeId ?? workspaceRuntimeIdForTest(),
              workspacePaneRoute: null,
              filesystemTarget: null,
            }
          : null
    useKeyboard({
      navigation: overrides.navigation ?? navigationWith(),
      currentWorkspaceId: overrides.currentWorkspaceId ?? null,
      currentBranchName: overrides.currentBranchName ?? null,
      currentGitWorkspaceNavigatorRowIdentity:
        overrides.currentGitWorkspaceNavigatorRowIdentity ??
        (overrides.currentBranchName ? { kind: 'branch', branchName: overrides.currentBranchName } : null),
      currentWorkspacePaneCommandTarget: overrides.currentWorkspacePaneCommandTarget ?? defaultCommandTarget,
      onShowHelp: () => {},
      isWorkspaceShortcutSuppressed: overrides.isWorkspaceShortcutSuppressed ?? (() => false),
      isSettingsOpen: overrides.isSettingsOpen ?? (() => false),
      onExitSettings: overrides.onExitSettings ?? (() => {}),
      openCreateWorktree: overrides.openCreateWorktree ?? (() => {}),
    })
    return () => null
  },
})

function navigationWith(overrides: AppNavigationOverridesForTest = {}): AppNavigationActions {
  return observedAppNavigationActionsForTest({
    currentWorkspacePaneRoute: observedWorkspacePaneRouteForTarget,
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  })
}

function workspaceRuntimeIdForTest(): string {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  if (!repo) throw new Error(`expected seeded repo ${REPO_ID}`)
  return repo.workspaceRuntimeId
}

function installNativeBridgeStub() {
  testWindow.goblinNative = currentNativeBridge({
    invokeIpc: vi.fn(async () => null),
    abortIpc: vi.fn(async () => false),
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
