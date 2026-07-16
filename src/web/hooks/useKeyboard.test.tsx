// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  observedWorkspacePaneRouteForTarget,
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoOperationsQueryData } from '#/web/repo-data-query.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

const testWindow = window as unknown as { goblinNative?: Window['goblinNative'] }
const REPO_ID = 'goblin+file:///tmp/keyboard-repo'
const WORKTREE_PATH = '/tmp/keyboard-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

interface HookHostOptions {
  currentRepoId: string | null
  currentBranchName: string | null
  isWorkspaceShortcutSuppressed: () => boolean
  isSettingsOpen: () => boolean
  onExitSettings: () => void
  openCreateWorktree: () => void
  navigation: PrimaryWindowNavigationActions
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  delete testWindow.goblinNative
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal,
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      currentBranchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: REPO_ID,
      repoRuntimeId: repoRuntimeIdForTest(),
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
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
      return true
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      currentBranchName: 'feature/no-worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: REPO_ID,
      repoRuntimeId: repoRuntimeIdForTest(),
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
      currentRepoId: REPO_ID,
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
      currentRepoId: REPO_ID,
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal,
    })
    await renderHookHost({
      currentRepoId: REPO_ID,
      currentBranchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession }),
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: REPO_ID,
      repoRuntimeId: repoRuntimeIdForTest(),
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

  test('primary modifier plus t creates a new terminal tab', async () => {
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    await renderHookHost({ currentRepoId: REPO_ID, currentBranchName: 'feature/worktree' })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).toHaveBeenCalledTimes(1)
  })

  test('primary modifier plus n opens the create worktree dialog', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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

  test('primary modifier plus n no-ops when there is no current repo', async () => {
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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

  test('primary modifier plus n reads busy state from server operations projection', async () => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
    })
    setRepoOperationsQueryData(REPO_ID, repo.repoRuntimeId, false, {
      operations: [serverOperation(repo.repoRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      loadedAt: 123,
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({ currentRepoId: REPO_ID, currentBranchName: 'feature/worktree' })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', {
      repoRoot: REPO_ID,

      repoRuntimeId: repoRuntimeIdForTest(),

      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })
})

function renderHookHost(overrides: Partial<HookHostOptions> = {}) {
  return renderInJsdom(<HookHost {...overrides} />)
}

function serverOperation(
  repoRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    repoRuntimeId,
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
  useKeyboard({
    navigation: overrides.navigation ?? navigationWith(),
    currentRepoId: overrides.currentRepoId ?? null,
    currentBranchName: overrides.currentBranchName ?? null,
    onShowHelp: () => {},
    isWorkspaceShortcutSuppressed: overrides.isWorkspaceShortcutSuppressed ?? (() => false),
    isSettingsOpen: overrides.isSettingsOpen ?? (() => false),
    onExitSettings: overrides.onExitSettings ?? (() => {}),
    openCreateWorktree: overrides.openCreateWorktree ?? (() => {}),
  })
  return null
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  const navigation: PrimaryWindowNavigationActions = {
    activateRepo: () => {},
    closeRepo: async () => ({ ok: true }),
    cycleRepo: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    commitRepoBranchWorkspacePaneRoute: () => false,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
    currentRepoBranchWorkspacePaneRoute:
      overrides.currentRepoBranchWorkspacePaneRoute ?? observedWorkspacePaneRouteForTarget,
  }
  if (!overrides.commitRepoBranchWorkspacePaneRoute) {
    navigation.commitRepoBranchWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
  }
  return navigation
}

function repoRuntimeIdForTest(): string {
  const repo = useReposStore.getState().repos[REPO_ID]
  if (!repo) throw new Error(`expected seeded repo ${REPO_ID}`)
  return repo.repoRuntimeId
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

function terminalWorktreeSnapshot(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'term-111111111111111111111',
      terminalWorktreeKey: WORKTREE_KEY,
      index: 1,
      repoRoot: REPO_ID,

      repoRuntimeId: repoRuntimeIdForTest(),

      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'term-111111111111111111111',
        terminalWorktreeKey: WORKTREE_KEY,
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
