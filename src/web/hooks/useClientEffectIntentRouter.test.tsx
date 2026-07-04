// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { createBranchSnapshot, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { preferredWorkspacePaneTabForTarget, workspacePaneTabsTargetForRepoBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'

const appDataClientMocks = vi.hoisted(() => ({
  clearRecentRepoHistory: vi.fn(async () => {}),
}))

vi.mock('#/web/settings-actions.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/settings-actions.ts')>('#/web/settings-actions.ts')
  return {
    ...actual,
    clearRecentRepoHistory: appDataClientMocks.clearRecentRepoHistory,
  }
})

const ipcEventListeners = new Set<(event: { type: string; repoRoot?: string; key?: string }) => void>()
const intentListeners = new Set<(event: any) => void>()
const closeAllOverlays = vi.fn()
let overlayOpen = false
let workspaceShortcutSuppressed = false
let currentRepoId: string | null = null
let navigation!: PrimaryWindowNavigationActions
const activateRepoSpy = vi.fn()
const closeRepoSpy = vi.fn()
const showRepoBranchWorkspacePaneTabSpy = vi.fn()
const consumeExternalOpenPathsSpy = vi.fn<() => Promise<string[]>>(async () => [])

beforeEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
  closeAllOverlays.mockClear()
  activateRepoSpy.mockClear()
  closeRepoSpy.mockClear()
  showRepoBranchWorkspacePaneTabSpy.mockClear()
  appDataClientMocks.clearRecentRepoHistory.mockClear()
  consumeExternalOpenPathsSpy.mockReset()
  consumeExternalOpenPathsSpy.mockResolvedValue([])
  overlayOpen = false
  workspaceShortcutSuppressed = false
  currentRepoId = null
  navigation = {
    activateRepo: (repoId) => {
      activateRepoSpy(repoId)
      useReposStore.getState().setActive(repoId)
    },
    closeRepo: (repoId) => {
      closeRepoSpy(repoId)
      useReposStore.getState().closeRepo(repoId)
    },
    cycleRepo: (direction) => useReposStore.getState().cycleActive(direction),
    selectRepoBranch: (repoId, branch) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
    },
    showRepoWorkspacePaneTab: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneTab(repoId, tab)
    },
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      showRepoBranchWorkspacePaneTabSpy(repoId, branch, tab)
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneTab(repoId, tab)
    },
    openSettings: () => {},
  }
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
        create: vi.fn(),
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
})

describe('useClientEffectIntentRouter', () => {
  test('terminal bell clicks close all overlays and focus the repo terminal view', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentRepoId = repo.id

    await renderHookHost()

    expect(intentListeners.size).toBeGreaterThan(0)
    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'terminal-bell-click', repoRoot: repo.id })
      await Promise.resolve()
    })

    expect(closeAllOverlays).toHaveBeenCalledTimes(1)
    const state = useReposStore.getState()
    expect(state.activeId).toBe(repo.id)
    expect(preferredWorkspacePaneTab(repo.id)).toBe('terminal')
  })

  test('terminal bell clicks switch to the emitting worktree branch and selected terminal', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-main' } }),
        createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } }),
      ],
    })
    currentRepoId = repo.id
    const terminalSessionId = 'session-2'
    const terminalWorktreeKey = formatTerminalWorktreeKey(repo.id, '/tmp/repo-feature')

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners)
        listener({ type: 'terminal-bell-click', repoRoot: repo.id, terminalSessionId, terminalWorktreeKey })
      await Promise.resolve()
    })

    const state = useReposStore.getState()
    expect(showRepoBranchWorkspacePaneTabSpy).toHaveBeenCalledWith(repo.id, 'feature/test', 'terminal')
    expect(state.repos[repo.id]?.ui.selectedBranch).toBe('feature/test')
    expect(preferredWorkspacePaneTab(repo.id)).toBe('terminal')
    expect(state.selectedTerminalSessionIdByTerminalWorktree).toMatchObject({
      [terminalWorktreeKey]: terminalSessionId,
    })
  })

  test('terminal bell clicks combine branch and terminal view navigation in a single route-driven action', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-main' } }),
        createBranchSnapshot('feature/test', { worktree: { path: '/tmp/repo-feature' } }),
      ],
    })
    const routeNavigationCalls: Array<{ repoId: string; branch: string; tab: string }> = []
    navigation = {
      ...navigation,
      selectRepoBranch: vi.fn(),
      showRepoWorkspacePaneTab: vi.fn(),
      showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
        routeNavigationCalls.push({ repoId, branch, tab })
      },
    }
    currentRepoId = repo.id
    const terminalSessionId = 'session-2'
    const terminalWorktreeKey = formatTerminalWorktreeKey(repo.id, '/tmp/repo-feature')

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners)
        listener({ type: 'terminal-bell-click', repoRoot: repo.id, terminalSessionId, terminalWorktreeKey })
      await Promise.resolve()
    })

    expect(routeNavigationCalls).toEqual([{ repoId: repo.id, branch: 'feature/test', tab: 'terminal' }])
  })

  test('close-repo menu action delegates to navigation close', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentRepoId = repo.id

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'close-repo-requested' })
      await Promise.resolve()
    })

    expect(closeRepoSpy).toHaveBeenCalledWith(repo.id)
    expect(useReposStore.getState().repos[repo.id]).toBeUndefined()
  })

  test('zen mode menu action toggles the zen mode state', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentRepoId = repo.id

    await renderHookHost()

    expect(useReposStore.getState().zenMode).toBe(false)
    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'workspace-zen-mode-toggle-requested' })
      await Promise.resolve()
    })

    expect(useReposStore.getState().zenMode).toBe(true)
  })

  test('current repo menu actions prefer the visible routed repo over store activeId', async () => {
    const activeRepoId = seedRepoState({
      id: '/tmp/active-repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      branchSnapshots: [
        createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/active-repo-worktree' } }),
      ],
    })
    const visibleRepo = seedRepoState({
      id: '/tmp/visible-repo',
      currentBranch: 'feature',
      selectedBranch: 'feature',
      branchSnapshots: [
        createBranchSnapshot('feature', { isCurrent: true, worktree: { path: '/tmp/visible-repo-worktree' } }),
      ],
    })
    useReposStore.setState((state) => ({
      ...state,
      repos: {
        [activeRepoId.id]: activeRepoId,
        [visibleRepo.id]: visibleRepo,
      },
      order: [activeRepoId.id, visibleRepo.id],
      activeId: activeRepoId.id,
      sessionReady: true,
    }))
    currentRepoId = visibleRepo.id

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'close-repo-requested' })
      await Promise.resolve()
    })

    expect(closeRepoSpy).toHaveBeenCalledWith(visibleRepo.id)
    expect(useReposStore.getState().repos[visibleRepo.id]).toBeUndefined()
    expect(useReposStore.getState().repos[activeRepoId.id]).toBeDefined()
  })

  test('open-recent-repo opens without store activation and then delegates activation to navigation', async () => {
    useReposStore.setState({
      ensureWorkspaceOpen: vi.fn(async () => ({ ok: true as const, id: '/tmp/recent-repo' })),
    })

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) {
        listener({
          type: 'open-recent-repo-requested',
          entry: { kind: 'local', id: '/tmp/recent-repo' },
        })
      }
      await Promise.resolve()
    })

    expect(useReposStore.getState().ensureWorkspaceOpen).toHaveBeenCalledWith({ kind: 'local', id: '/tmp/recent-repo' })
    expect(activateRepoSpy).toHaveBeenCalledWith('/tmp/recent-repo')
  })

  test('workspace view menu actions are suppressed while settings-like routes are active', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      currentBranch: 'main',
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main', { isCurrent: true, worktree: { path: '/tmp/repo-worktree' } })],
    })
    currentRepoId = repo.id
    workspaceShortcutSuppressed = true

    await renderHookHost()

    await act(async () => {
      for (const listener of intentListeners) {
        listener({ type: 'show-workspace-pane-tab-requested', tab: 'terminal' })
        listener({ type: 'terminal-primary-action-requested' })
        listener({ type: 'workspace-zen-mode-toggle-requested' })
        listener({ type: 'close-repo-requested' })
      }
      await Promise.resolve()
    })

    const state = useReposStore.getState()
    expect(preferredWorkspacePaneTab(repo.id)).toBe('status')
    expect(state.zenMode).toBe(false)
    expect(closeRepoSpy).not.toHaveBeenCalled()
  })

  test('drains externally opened repo paths through the centralized intent router', async () => {
    useReposStore.setState({
      ensureWorkspaceOpen: vi.fn(async (path: string | { id: string }) => ({
        ok: true as const,
        id: typeof path === 'string' ? path : path.id,
      })),
    })
    consumeExternalOpenPathsSpy
      .mockResolvedValueOnce(['/tmp/repo-a', '/tmp/repo-b'] as string[])
      .mockResolvedValueOnce([] as string[])

    await renderHookHost()
    await act(async () => {
      for (const listener of intentListeners) listener({ type: 'external-open-enqueued' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useReposStore.getState().ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/repo-a')
    expect(useReposStore.getState().ensureWorkspaceOpen).toHaveBeenCalledWith('/tmp/repo-b')
    expect(activateRepoSpy).toHaveBeenCalledWith('/tmp/repo-a')
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
      for (const listener of intentListeners) listener({ type: 'clear-recent-repos-requested' })
      await Promise.resolve()
    })

    expect(appDataClientMocks.clearRecentRepoHistory).toHaveBeenCalledTimes(1)
  })
})

function preferredWorkspacePaneTab(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  return repo ? preferredWorkspacePaneTabForTarget(repo.ui, workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: repo.data.branches }, repo.ui.selectedBranch)) : null
}

async function renderHookHost() {
  renderInJsdom(<HookHost />)
}

function HookHost() {
  useClientEffectIntentRouter({
    navigation,
    currentRepoId,
    closeAllOverlays,
    openRepoPathDialog: () => {},
    openCloneRepo: () => {},
    openRemoteRepo: () => {},
    openCreateWorktree: () => {},
    isOverlayOpen: () => overlayOpen,
    isWorkspaceShortcutSuppressed: () => workspaceShortcutSuppressed,
  })
  return null
}
