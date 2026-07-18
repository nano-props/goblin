// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import {
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const appDataClientMocks = vi.hoisted(() => ({
  clearRecentWorkspaceHistory: vi.fn(async () => {}),
  removeRepoFromWorkspace: vi.fn(async () => {}),
}))

vi.mock('#/web/settings-actions.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/settings-actions.ts')>('#/web/settings-actions.ts')
  return {
    ...actual,
    clearRecentWorkspaceHistory: appDataClientMocks.clearRecentWorkspaceHistory,
    removeRepoFromWorkspace: appDataClientMocks.removeRepoFromWorkspace,
  }
})

const ipcEventListeners = new Set<(event: { type: string; repoRoot?: string; key?: string }) => void>()
const intentListeners = new Set<(event: any) => void>()
const closeAllOverlays = vi.fn()
let overlayOpen = false
let workspaceShortcutSuppressed = false
let currentWorkspaceId: string | null = null
let currentBranchName: string | null = null
let currentWorkspacePaneRoute: WorkspacePaneRoute | null = null
let currentFilesystemTarget: WorkspacePaneFilesystemTarget | null = null
let navigation!: PrimaryWindowNavigationActions
const activateWorkspaceSpy = vi.fn()
const closeRepoSpy = vi.fn()
const showRepoBranchWorkspacePaneTabSpy = vi.fn()
const showRepoBranchTerminalSessionSpy = vi.fn()
const consumeExternalOpenPathsSpy = vi.fn<() => Promise<string[]>>(async () => [])

beforeEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
  closeAllOverlays.mockClear()
  activateWorkspaceSpy.mockClear()
  closeRepoSpy.mockClear()
  showRepoBranchWorkspacePaneTabSpy.mockClear()
  showRepoBranchTerminalSessionSpy.mockClear()
  appDataClientMocks.clearRecentWorkspaceHistory.mockClear()
  appDataClientMocks.removeRepoFromWorkspace.mockClear()
  consumeExternalOpenPathsSpy.mockReset()
  consumeExternalOpenPathsSpy.mockResolvedValue([])
  overlayOpen = false
  workspaceShortcutSuppressed = false
  currentWorkspaceId = null
  currentBranchName = null
  currentWorkspacePaneRoute = null
  currentFilesystemTarget = null
  setTerminalSessionCommandBridge(null)
  navigation = {
    currentWorkspacePaneRoute: () => undefined,
    activateWorkspace: (repoId) => {
      activateWorkspaceSpy(repoId)
    },
    closeWorkspace: async (repoId) => {
      closeRepoSpy(repoId)
      return await useReposStore.getState().closeWorkspace(repoId)
    },
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      showRepoBranchWorkspacePaneTabSpy(repoId, branch, tab)
      const state = useReposStore.getState()
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    },
    showRepoBranchTerminalSession: (repoId, branch, terminalSessionId) => {
      showRepoBranchTerminalSessionSpy(repoId, branch, terminalSessionId)
      return true
    },
    commitWorkspacePaneRoute: () => false,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
  }
  navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      invokeIpc: vi.fn(async () => null),
      abortIpc: vi.fn(async () => true),
      onEvent: vi.fn((cb: (event: { type: string; repoRoot?: string; key?: string }) => void) => {
        ipcEventListeners.add(cb)
        return () => {
          ipcEventListeners.delete(cb)
        }
      }),
      onIntent: vi.fn((cb: (event: any) => void) => {
        intentListeners.add(cb)
        return () => {
          intentListeners.delete(cb)
        }
      }),
      pathForFile: vi.fn(() => ''),
      host: {
        consumeExternalOpenPaths: consumeExternalOpenPathsSpy,
      },
      terminal: {
        open: vi.fn(),
        restart: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        takeover: vi.fn(),
        close: vi.fn(),
        pruneTerminals: vi.fn(),
        notifyBell: vi.fn(),
        sendTestNotification: vi.fn(),
        setBadge: vi.fn(),
        onOutput: vi.fn(() => () => {}),
        onBell: vi.fn(() => () => {}),
        onTitle: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {}),
      },
    },
  })
})

afterEach(() => {
  ipcEventListeners.clear()
  intentListeners.clear()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

describe('useClientEffectIntentRouter', () => {
  test('terminal bell clicks without a worktree target do not infer a branch route', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentWorkspaceId = repo.id

    await renderHookHost()

    expect(intentListeners.size).toBeGreaterThan(0)
    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'terminal-bell-click', repoRoot: repo.id })
      await Promise.resolve()
    })

    expect(closeAllOverlays).not.toHaveBeenCalled()
    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
  })

  test('terminal bell clicks switch to the emitting worktree branch and selected terminal', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-main' } }),
        createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } }),
      ],
    })
    currentWorkspaceId = repo.id
    const terminalSessionId = 'term-222222222222222222222'
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(repo.id, '/tmp/repo-feature')

    await renderHookHost()
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-main',
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      for (const listener of intentListeners)
        listener({ type: 'terminal-bell-click', repoRoot: repo.id, terminalSessionId, terminalWorktreeKey })
    })

    await waitFor(() => {
      expect(showRepoBranchTerminalSessionSpy).toHaveBeenCalledWith(repo.id, 'feature/test', terminalSessionId)
    })
    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
  })

  test('terminal bell clicks combine branch and terminal view navigation in a single route-driven action', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-main' } }),
        createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } }),
      ],
    })
    const routeNavigationCalls: Array<{ repoId: string; branch: string; terminalSessionId: string }> = []
    navigation = {
      ...navigation,
      selectRepoBranch: vi.fn(),
      showRepoBranchEmptyWorkspacePane: () => true,
      showRepoBranchTerminalSession: (repoId, branch, terminalSessionId) => {
        routeNavigationCalls.push({ repoId, branch, terminalSessionId })
        return true
      },
    }
    navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
    currentWorkspaceId = repo.id
    const terminalSessionId = 'term-222222222222222222222'
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(repo.id, '/tmp/repo-feature')

    await renderHookHost()
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-main',
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      for (const listener of intentListeners)
        listener({ type: 'terminal-bell-click', repoRoot: repo.id, terminalSessionId, terminalWorktreeKey })
    })

    await waitFor(() => {
      expect(routeNavigationCalls).toEqual([{ repoId: repo.id, branch: 'feature/test', terminalSessionId }])
    })
  })

  test('close-repo menu action delegates to navigation close', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentWorkspaceId = repo.id

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
      await Promise.resolve()
    })

    expect(closeRepoSpy).toHaveBeenCalledWith(repo.id)
    expect(useReposStore.getState().repos[repo.id]).toBeUndefined()
  })

  test('close-repo menu action reports shared membership write failures', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentWorkspaceId = repo.id
    appDataClientMocks.removeRepoFromWorkspace.mockRejectedValueOnce(new Error('workspace write failed'))
    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
      await Promise.resolve()
    })

    expect(useReposStore.getState().repos[repo.id]).toBeDefined()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('error.failed-read-repo'))
  })

  test('zen mode menu action toggles the zen mode state', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentWorkspaceId = repo.id

    await renderHookHost()

    expect(useReposStore.getState().zenMode).toBe(false)
    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'workspace-zen-mode-toggle-requested' })
      await Promise.resolve()
    })

    expect(useReposStore.getState().zenMode).toBe(true)
  })

  test('current repo menu actions prefer the visible routed repo over restored repo id', async () => {
    const restoredRepo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/restored-repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/restored-repo-worktree' } }),
      ],
    })
    const visibleRepo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/visible-repo',
      currentBranch: 'feature',
      currentBranchName: 'feature',
      branchSnapshots: [
        createBranchSnapshot('feature', { isCurrent: true, worktree: { path: '/tmp/visible-repo-worktree' } }),
      ],
    })
    useReposStore.setState((state) => ({
      ...state,
      repos: {
        [restoredRepo.id]: restoredRepo,
        [visibleRepo.id]: visibleRepo,
      },
      order: [restoredRepo.id, visibleRepo.id],
      restoredRepoId: restoredRepo.id,
      workspaceMembershipReady: true,
    }))
    currentWorkspaceId = visibleRepo.id

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
      await Promise.resolve()
    })

    expect(closeRepoSpy).toHaveBeenCalledWith(visibleRepo.id)
    expect(useReposStore.getState().repos[visibleRepo.id]).toBeUndefined()
    expect(useReposStore.getState().repos[restoredRepo.id]).toBeDefined()
  })

  test('open-recent-workspace opens without store activation and then delegates activation to navigation', async () => {
    useReposStore.setState({
      ensureWorkspaceOpen: vi.fn(async () => ({ ok: true as const, workspaceId: workspaceIdForTest('goblin+file:///tmp/recent-workspace') })),
    })

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) {
        listener({
          type: 'open-recent-workspace-requested',
          entry: { kind: 'local', id: 'goblin+file:///tmp/recent-workspace' },
        })
      }
      await Promise.resolve()
    })

    expect(useReposStore.getState().ensureWorkspaceOpen).toHaveBeenCalledWith({
      kind: 'local',
      id: 'goblin+file:///tmp/recent-workspace',
    })
    expect(activateWorkspaceSpy).toHaveBeenCalledWith('goblin+file:///tmp/recent-workspace')
  })

  test('workspace view menu actions are suppressed while settings-like routes are active', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentWorkspaceId = repo.id
    workspaceShortcutSuppressed = true

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) {
        listener({ type: 'show-workspace-pane-tab-requested', tab: 'terminal' })
        listener({ type: 'terminal-primary-action-requested' })
        listener({ type: 'workspace-zen-mode-toggle-requested' })
        listener({ type: 'close-workspace-requested' })
      }
      await Promise.resolve()
    })

    const state = useReposStore.getState()
    expect(preferredWorkspacePaneTab(repo.id)).toBe('status')
    expect(state.zenMode).toBe(false)
    expect(closeRepoSpy).not.toHaveBeenCalled()
  })

  test('native new-terminal and close intents preserve a static route opener', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branches: [createRepoBranch('main', { worktree: { path: '/tmp/repo-worktree' } })],
      workspacePaneTabsByBranch: {
        main: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    currentWorkspaceId = repo.id
    currentBranchName = 'main'
    currentWorkspacePaneRoute = { kind: 'static', tab: 'status' }
    currentFilesystemTarget = {
      kind: 'git-worktree',
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      rootPath: '/tmp/repo-worktree',
      head: { kind: 'branch', branchName: 'main' },
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
    }
    useTerminalProjectionHydrationStore.getState().markProjectionReady(repo.id, repo.workspaceRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(repo.id, '/tmp/repo-worktree')
    let visibleSessionIds = ['term-111111111111111111111']
    let workspacePaneTabsTestBridge!: ReturnType<typeof installWorkspacePaneTabsTestBridge>
    useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-111111111111111111111')
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-222222222222222222222'
      const coordinates = terminalSessionCoordinates(base)
      const branchName = terminalPresentationBranch(base.presentation)
      if (!branchName) throw new Error('expected Git worktree terminal fixture')
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      workspacePaneTabsTestBridge.addRuntimeTab({
        repoRoot: coordinates.repoRoot,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        branchName,
        worktreePath: terminalExecutionPath(base.target),
        terminalSessionId,
      })
      useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, terminalSessionId)
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot(terminalWorktreeKey, visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge({
      onEffectIntent: (cb) => {
        intentListeners.add(cb)
        return () => {
          intentListeners.delete(cb)
        }
      },
    })
    const host = renderInJsdom(<HookHost />)
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-worktree',
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'terminal-new-tab-requested' })
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(showRepoBranchTerminalSessionSpy).toHaveBeenCalledWith(repo.id, 'main', 'term-222222222222222222222')
    })

    currentWorkspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' }
    await act(async () => {
      host.rerender(<HookHost />)
      await Promise.resolve()
    })
    showRepoBranchWorkspacePaneTabSpy.mockClear()
    showRepoBranchTerminalSessionSpy.mockClear()
    expect(
      workspacePaneTabTargetForBranch(repo.id, 'main', {
        workspacePaneRoute: currentWorkspacePaneRoute,
      })?.activeTab?.identity,
    ).toBe('terminal:term-222222222222222222222')
    seedInitialObservedWorkspacePaneRouteForTest({
      repoId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-worktree',
      route: { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' },
    })

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'workspace-pane-close-tab-or-window-requested' })
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(closeTerminalByDescriptor).toHaveBeenCalledWith(
        'term-222222222222222222222',
        terminalSessionBaseForTest({
          repoRoot: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
        branch: 'main',
        worktreePath: '/tmp/repo-worktree',
        }),
      )
    })
    expect(showRepoBranchWorkspacePaneTabSpy).toHaveBeenCalledWith(repo.id, 'main', 'status')
    expect(showRepoBranchTerminalSessionSpy).not.toHaveBeenCalled()
  })

  test('drains externally opened repo paths through the centralized intent router', async () => {
    useReposStore.setState({
      ensureWorkspaceOpen: vi.fn(async (path: string | { id: string }) => ({
        ok: true as const,
        workspaceId: workspaceIdForTest(typeof path === 'string' ? path : path.id),
      })),
    })
    consumeExternalOpenPathsSpy
      .mockResolvedValueOnce(['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'] as string[])
      .mockResolvedValueOnce([] as string[])

    await renderHookHost()
    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'external-open-enqueued' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useReposStore.getState().ensureWorkspaceOpen).toHaveBeenCalledWith('goblin+file:///tmp/repo-a')
    expect(useReposStore.getState().ensureWorkspaceOpen).toHaveBeenCalledWith('goblin+file:///tmp/repo-b')
    expect(activateWorkspaceSpy).toHaveBeenCalledWith('goblin+file:///tmp/repo-a')
  })

  test('theme menu intents update theme through the client store', async () => {
    const setPref = vi.fn(async () => {})
    useThemeStore.setState((state) => ({ ...state, setPref }))

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'theme-pref-set-requested', pref: 'dark' })
      await Promise.resolve()
    })

    expect(setPref).toHaveBeenCalledWith('dark')
  })

  test('language menu intents update i18n through the client store', async () => {
    const setPref = vi.fn(async () => {})
    useI18nStore.setState((state) => ({ ...state, setPref }))

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'lang-pref-set-requested', pref: 'ko' })
      await Promise.resolve()
    })

    expect(setPref).toHaveBeenCalledWith('ko')
  })

  test('clear recent intent clears server-backed recents through the client client', async () => {
    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'clear-recent-workspaces-requested' })
      await Promise.resolve()
    })

    expect(appDataClientMocks.clearRecentWorkspaceHistory).toHaveBeenCalledTimes(1)
  })
})

function preferredWorkspacePaneTab(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          'main',
        ),
      )
    : null
}

async function renderHookHost() {
  renderInJsdom(<HookHost />)
}

function HookHost() {
  useClientEffectIntentRouter({
    navigation,
    currentWorkspaceId,
    currentWorkspacePaneCommandTarget: currentBranchName
      ? currentFilesystemTarget?.kind === 'git-worktree'
        ? {
            kind: 'git-worktree',
            workspacePaneRoute: currentWorkspacePaneRoute,
            filesystemTarget: currentFilesystemTarget,
          }
        : {
            kind: 'git-branch',
            branchName: currentBranchName,
            workspacePaneRoute: currentWorkspacePaneRoute,
          }
      : null,
    closeAllOverlays,
    openWorkspacePathDialog: () => {},
    openCloneRepo: () => {},
    openRemoteWorkspace: () => {},
    openCreateWorktree: () => {},
    isOverlayOpen: () => overlayOpen,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutSuppressed,
  })
  return null
}

function terminalWorktreeSnapshot(
  terminalWorktreeKey: string,
  terminalSessionIds: readonly string[],
): TerminalWorktreeSnapshot {
  const selectedKey = useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null
  const sessions = terminalSessionIds.map((terminalSessionId, index) => ({
    type: 'terminal' as const,
    terminalSessionId,
    terminalWorktreeKey,
    index: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: terminalSessionId === selectedKey,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedSession = sessions.find((session) => session.terminalSessionId === selectedKey) ?? null
  return {
    terminalWorktreeKey,
    selectedDescriptor: selectedSession
      ? {
          terminalSessionId: selectedSession.terminalSessionId,
          index: selectedSession.index,
          target: {
            kind: 'git-worktree' as const,
            workspaceId: canonicalWorkspaceLocator('goblin+file:///tmp/repo')!,
            workspaceRuntimeId: useReposStore.getState().repos['goblin+file:///tmp/repo']?.workspaceRuntimeId ?? '',
            root: canonicalWorkspaceLocator('goblin+file:///tmp/repo-worktree')!,
          },
          presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'main' } },
        }
      : null,
    sessions,
    count: sessions.length,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}
