// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'

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
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { TerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { terminalDescriptorForTest, terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoOperationsQueryData } from '#/web/repo-data-query.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

const testWindow = window as unknown as { goblinNative?: Window['goblinNative'] }
const REPO_ID = 'goblin+file:///tmp/keyboard-repo'
const REPO_PATH = '/tmp/keyboard-repo'
const WORKTREE_PATH = '/tmp/keyboard-worktree'
const WORKTREE_KEY = formatTerminalWorktreeKeyForPath(REPO_ID, WORKTREE_PATH)
const FILESYSTEM_CAPABILITIES = {
  files: { read: true, write: true },
  terminal: { available: true },
  git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
} as const

interface HookHostOptions {
  currentWorkspaceId: string | null
  currentBranchName: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
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
      currentWorkspaceId: REPO_ID,
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
      currentWorkspaceId: REPO_ID,
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal,
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
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
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: {
        kind: 'git-worktree',
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        filesystemTarget: {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          workspaceRuntimeId: repoRuntimeIdForTest(),
          rootPath: WORKTREE_PATH,
          head: { kind: 'branch', branchName: 'feature/worktree' },
          capabilities: FILESYSTEM_CAPABILITIES,
        },
      },
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).toHaveBeenCalledTimes(1)
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
      terminalWorktreeSnapshot: (terminalWorktreeKey) => ({
        terminalWorktreeKey,
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
        kind: 'workspace-root',
        workspacePaneRoute: null,
        filesystemTarget: {
          kind: 'workspace-root',
          workspaceId: REPO_ID,
          workspaceRuntimeId: repoRuntimeIdForTest(),
          rootPath: REPO_PATH,
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
        },
      },
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true }))
      await Promise.resolve()
    })

    expect(createTerminal).toHaveBeenCalledWith(
      terminalSessionBaseForTest({
        repoRoot: REPO_ID,
        repoRuntimeId: repoRuntimeIdForTest(),
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
    setRepoOperationsQueryData(REPO_ID, repo.repoRuntimeId, false, {
      operations: [serverOperation(repo.repoRuntimeId, { kind: 'create-worktree', phase: 'running' })],
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
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
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    await renderHookHost({
      currentWorkspaceId: REPO_ID,
      currentBranchName: 'feature/worktree',
      currentWorkspacePaneCommandTarget: {
        kind: 'git-worktree',
        filesystemTarget: {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          workspaceRuntimeId: repoRuntimeIdForTest(),
          rootPath: WORKTREE_PATH,
          head: { kind: 'branch', branchName: 'feature/worktree' },
          capabilities: FILESYSTEM_CAPABILITIES,
        },
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
        repoRuntimeId: repoRuntimeIdForTest(),
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    )
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
  const repo = overrides.currentWorkspaceId ? useReposStore.getState().repos[overrides.currentWorkspaceId] : null
  const branch =
    repo && overrides.currentBranchName
      ? readRepoBranchSnapshotQueryProjection(repo)?.branches.find(
          (candidate) => candidate.name === overrides.currentBranchName,
        )
      : null
  const defaultCommandTarget =
    repo?.workspaceProbe.status === 'ready' && overrides.currentBranchName && branch?.worktree
      ? {
          kind: 'git-worktree' as const,
          branchName: overrides.currentBranchName,
          workspacePaneRoute: null,
          filesystemTarget: {
            kind: 'git-worktree' as const,
            workspaceId: repo.id,
            workspaceRuntimeId: repo.repoRuntimeId,
            rootPath: branch.worktree.path,
            head: { kind: 'branch' as const, branchName: overrides.currentBranchName },
            capabilities: repo.workspaceProbe.capabilities,
          },
        }
      : overrides.currentBranchName
        ? { kind: 'git-branch' as const, branchName: overrides.currentBranchName, workspacePaneRoute: null }
        : null
  useKeyboard({
    navigation: overrides.navigation ?? navigationWith(),
    currentWorkspaceId: overrides.currentWorkspaceId ?? null,
    currentBranchName: overrides.currentBranchName ?? null,
    currentWorkspacePaneCommandTarget:
      overrides.currentWorkspacePaneCommandTarget ??
      defaultCommandTarget,
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
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    commitWorkspacePaneRoute: () => false,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
    currentWorkspacePaneRoute:
      overrides.currentWorkspacePaneRoute ?? observedWorkspacePaneRouteForTarget,
  }
  if (!overrides.commitWorkspacePaneRoute) {
    navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
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
    selectedDescriptor: terminalDescriptorForTest({
      terminalSessionId: 'term-111111111111111111111',
      index: 1,
      repoRoot: REPO_ID,

      repoRuntimeId: repoRuntimeIdForTest(),

      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    }),
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
