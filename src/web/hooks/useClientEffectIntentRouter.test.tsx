// @vitest-environment jsdom
import {
  createRepoWorktreeSnapshotForTest,
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { defineComponent, ref } from 'vue'

import { waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useClientEffectIntentRouter } from '#/web/hooks/useClientEffectIntentRouter.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { themeStore } from '#/web/stores/theme.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import {
  observedAppNavigationActionsForTest,
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type ObservedAppNavigationActionsForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { repoPresentationFromQueryForTest } from '#/web/test-utils/repo-store.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { terminalExecutionPath, terminalSessionCoordinates, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import type { TerminalFilesystemTargetSnapshot } from '#/web/components/terminal/types.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneFilesystemRootPath,
  type WorkspacePaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

const appDataClientMocks = vi.hoisted(() => ({
  clearRecentWorkspaceHistory: vi.fn(async () => {}),
  removeWorkspaceFromSession: vi.fn(async () => {}),
}))

vi.mock('#/web/settings-actions.ts', () => ({
  clearRecentWorkspaceHistory: appDataClientMocks.clearRecentWorkspaceHistory,
  removeWorkspaceFromSession: appDataClientMocks.removeWorkspaceFromSession,
}))

const intentListeners = new Set<(event: any) => void>()
let nativeIntentSubscriptionStarts = 0
const closeAllOverlays = vi.fn()
const openWorkspacePathDialogSpy = vi.fn()
const openCloneRepoSpy = vi.fn()
const openRemoteWorkspaceSpy = vi.fn()
let overlayOpen = false
let workspaceShortcutSuppressed = false
let currentWorkspaceId: WorkspaceId | null = null
const authenticatedBootstrapState = ref<AuthenticatedAppBootstrapState>({ status: 'ready' })
let currentBranchName: string | null = null
let currentWorkspacePaneRoute: WorkspacePaneRoute | null = null
let currentFilesystemTarget: WorkspacePaneFilesystemTarget | null = null
let navigation!: ObservedAppNavigationActionsForTest
const activateWorkspaceSpy = vi.fn()
const closeRepoSpy = vi.fn()
const showRepoBranchWorkspacePaneTabSpy = vi.fn()
const showWorkspaceRootPaneTabSpy = vi.fn()
const commitFilesystemWorkspacePaneRouteSpy = vi.fn()
const consumeExternalOpenPathsSpy = vi.fn<() => Promise<string[]>>(async () => [])

beforeEach(() => {
  resetWorkspacesStore()
  setClientBridgeForTests(null)
  closeAllOverlays.mockClear()
  openWorkspacePathDialogSpy.mockClear()
  openCloneRepoSpy.mockClear()
  openRemoteWorkspaceSpy.mockClear()
  activateWorkspaceSpy.mockClear()
  closeRepoSpy.mockClear()
  showRepoBranchWorkspacePaneTabSpy.mockClear()
  showWorkspaceRootPaneTabSpy.mockClear()
  commitFilesystemWorkspacePaneRouteSpy.mockClear()
  appDataClientMocks.clearRecentWorkspaceHistory.mockReset()
  appDataClientMocks.clearRecentWorkspaceHistory.mockResolvedValue(undefined)
  appDataClientMocks.removeWorkspaceFromSession.mockReset()
  appDataClientMocks.removeWorkspaceFromSession.mockResolvedValue(undefined)
  consumeExternalOpenPathsSpy.mockReset()
  consumeExternalOpenPathsSpy.mockResolvedValue([])
  overlayOpen = false
  workspaceShortcutSuppressed = false
  currentWorkspaceId = null
  authenticatedBootstrapState.value = { status: 'ready' }
  currentBranchName = null
  currentWorkspacePaneRoute = null
  currentFilesystemTarget = null
  nativeIntentSubscriptionStarts = 0
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
  setTerminalSessionCommandBridge(null)
  navigation = observedAppNavigationActionsForTest({
    currentWorkspacePaneRoute: () => undefined,
    activateWorkspace: (repoId) => {
      activateWorkspaceSpy(repoId)
    },
    closeWorkspace: async (repoId) => {
      closeRepoSpy(repoId)
      return await workspacesStore.getState().closeWorkspace(repoId)
    },
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      showRepoBranchWorkspacePaneTabSpy(repoId, branch, tab)
      const state = workspacesStore.getState()
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    },
    showWorkspaceRootPaneTab: (workspaceId, presentation) => {
      showWorkspaceRootPaneTabSpy(workspaceId, presentation)
      return true
    },
    commitFilesystemWorkspacePaneRoute: async (target, route, options) => {
      commitFilesystemWorkspacePaneRouteSpy(target, route)
      options?.onCommit?.()
      return true
    },
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
  })
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: currentNativeBridge({
      invokeIpc: vi.fn(async () => null),
      abortIpc: vi.fn(async () => true),
      onIntent: vi.fn((cb: (event: any) => void) => {
        nativeIntentSubscriptionStarts += 1
        intentListeners.add(cb)
        return () => {
          intentListeners.delete(cb)
        }
      }),
      host: {
        openSettingsWindow: vi.fn(async () => true),
        openExternalUrl: vi.fn(async () => ({ ok: true, message: '' })),
        openDirectoryDialog: vi.fn(async () => null),
        consumeExternalOpenPaths: consumeExternalOpenPathsSpy,
      },
    }),
  })
})

afterEach(() => {
  intentListeners.clear()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

describe('useClientEffectIntentRouter', () => {
  test('dispatches global dialogs while workspace bootstrap is still restoring', async () => {
    currentWorkspaceId = null
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) {
        listener({ type: 'open-workspace-path-requested' })
        listener({ type: 'clone-repo-requested' })
        listener({ type: 'open-remote-workspace-requested' })
      }
    })

    await waitFor(() => {
      expect(openWorkspacePathDialogSpy).toHaveBeenCalledOnce()
      expect(openCloneRepoSpy).toHaveBeenCalledOnce()
      expect(openRemoteWorkspaceSpy).toHaveBeenCalledOnce()
    })
  })

  test('admits a cold-start terminal bell only after bootstrap restores its workspace authority', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const workspaceRuntimeId = 'workspace-runtime-test'
    const terminalSessionId = 'term-111111111111111111111'
    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) {
        listener({
          type: 'terminal-bell-click',
          terminalSessionId,
          session: {
            target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId },
            presentation: { kind: 'workspace-root' },
          },
        })
      }
    })
    expect(commitFilesystemWorkspacePaneRouteSpy).not.toHaveBeenCalled()

    const workspace = emptyWorkspace(workspaceId, workspaceRuntimeId)
    workspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId,
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'ready' }
    })

    await waitFor(() => {
      expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
        {
          routeTarget: { kind: 'workspace-root', workspaceId },
          workspaceRuntimeId,
        },
        { kind: 'terminal', terminalSessionId },
      )
    })
  })

  test('rejects pending intents on bootstrap failure without replaying them after a later retry', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const workspaceId = workspaceIdForTest('goblin+file:///pending-workspace')
    const workspace = emptyWorkspace(workspaceId, 'pending-runtime')
    workspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })
    currentWorkspaceId = workspaceId
    await renderHookHost()
    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
    })

    authenticatedBootstrapState.value = { status: 'failed', message: 'restore failed for test' }
    await flushTestUpdates(() => {})
    expect(closeRepoSpy).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('workspace-restore.failed')

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'restoring-workspace' }
      authenticatedBootstrapState.value = { status: 'ready' }
    })
    expect(closeRepoSpy).not.toHaveBeenCalled()
  })

  test('does not retain a workspace-only intent when the ready route has no workspace target', async () => {
    currentWorkspaceId = null
    await renderHookHost()
    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
    })

    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
    })
    currentWorkspaceId = repo.id
    await flushTestUpdates(() => {})

    expect(closeRepoSpy).not.toHaveBeenCalled()
  })

  test('keeps one ingress subscription across route renders and reads the latest route state', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-worktree', { isPrimary: false, isLocked: false }),
      ],
    })
    const host = await renderHookHost()

    expect(nativeIntentSubscriptionStarts).toBe(1)
    expect(intentListeners.size).toBe(1)

    currentWorkspaceId = repo.id
    await flushTestUpdates(async () => {
      await host.rerender(<HookHost />)
    })

    expect(nativeIntentSubscriptionStarts).toBe(1)
    expect(intentListeners.size).toBe(1)

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
    })

    await waitFor(() => {
      expect(closeRepoSpy).toHaveBeenCalledWith(repo.id)
      expect(workspacesStore.getState().workspaces[repo.id]).toBeUndefined()
    })
  })

  test('terminal bell clicks switch to the emitting worktree branch and selected terminal', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main'), createBranchSnapshot('feature/test')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-main', { isPrimary: false, isLocked: false }),
        createRepoWorktreeSnapshotForTest('feature/test', '/tmp/repo-feature', { isPrimary: false, isLocked: false }),
      ],
    })
    currentWorkspaceId = repo.id
    const terminalSessionId = 'term-222222222222222222222'
    setWorkspacePaneTabsForTargetQueryData({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/test',
      worktreePath: '/tmp/repo-feature',
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })

    await renderHookHost()
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-main',
      route: { kind: 'static', tab: 'status' },
    })

    await flushTestUpdates(async () => {
      for (const listener of intentListeners)
        listener({
          type: 'terminal-bell-click',
          terminalSessionId,
          session: {
            target: {
              kind: 'git-worktree',
              workspaceId: repo.id,
              workspaceRuntimeId: repo.workspaceRuntimeId,
              root: workspaceIdForTest('goblin+file:///tmp/repo-feature'),
            },
            presentation: { kind: 'git-worktree' },
          },
        })
    })

    await waitFor(() => {
      expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          routeTarget: { kind: 'git-worktree', workspaceId: repo.id, worktreePath: '/tmp/repo-feature' },
        }),
        { kind: 'terminal', terminalSessionId },
      )
    })
    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
  })

  test('terminal bell clicks restore a plain Workspace root terminal', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const workspace = emptyWorkspace(workspaceId, 'workspace-runtime-test')
    workspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })
    const terminalSessionId = 'term-111111111111111111111'
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })

    await renderHookHost()
    await flushTestUpdates(async () => {
      for (const listener of intentListeners) {
        listener({
          type: 'terminal-bell-click',
          terminalSessionId,
          session: {
            target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: workspace.workspaceRuntimeId },
            presentation: { kind: 'workspace-root' },
          },
        })
      }
    })

    expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
      {
        routeTarget: { kind: 'workspace-root', workspaceId },
        workspaceRuntimeId: workspace.workspaceRuntimeId,
      },
      { kind: 'terminal', terminalSessionId },
    )
    expect(showWorkspaceRootPaneTabSpy).not.toHaveBeenCalled()
  })

  test('terminal bell clicks combine branch and terminal view navigation in a single route-driven action', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main'), createBranchSnapshot('feature/test')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-main', { isPrimary: false, isLocked: false }),
        createRepoWorktreeSnapshotForTest('feature/test', '/tmp/repo-feature', { isPrimary: false, isLocked: false }),
      ],
    })
    navigation = {
      ...navigation,
      selectRepoBranch: vi.fn(),
      showRepoBranchEmptyWorkspacePane: () => true,
    }
    navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
    currentWorkspaceId = repo.id
    const terminalSessionId = 'term-222222222222222222222'
    setWorkspacePaneTabsForTargetQueryData({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/test',
      worktreePath: '/tmp/repo-feature',
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })

    await renderHookHost()
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-main',
      route: { kind: 'static', tab: 'status' },
    })

    await flushTestUpdates(async () => {
      for (const listener of intentListeners)
        listener({
          type: 'terminal-bell-click',
          terminalSessionId,
          session: {
            target: {
              kind: 'git-worktree',
              workspaceId: repo.id,
              workspaceRuntimeId: repo.workspaceRuntimeId,
              root: workspaceIdForTest('goblin+file:///tmp/repo-feature'),
            },
            presentation: { kind: 'git-worktree' },
          },
        })
    })

    await waitFor(() => {
      expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          routeTarget: { kind: 'git-worktree', workspaceId: repo.id, worktreePath: '/tmp/repo-feature' },
        }),
        { kind: 'terminal', terminalSessionId },
      )
    })
  })

  test('close-repo menu action delegates to navigation close', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-worktree', { isPrimary: false, isLocked: false }),
      ],
    })
    currentWorkspaceId = repo.id

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
    })

    await waitFor(() => {
      expect(closeRepoSpy).toHaveBeenCalledWith(repo.id)
      expect(workspacesStore.getState().workspaces[repo.id]).toBeUndefined()
    })
  })

  test('close-repo menu action reports shared membership write failures', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-worktree', { isPrimary: false, isLocked: false }),
      ],
    })
    currentWorkspaceId = repo.id
    appDataClientMocks.removeWorkspaceFromSession.mockRejectedValueOnce(new Error('workspace write failed'))
    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
    })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('error.workspace-close-failed'))
    expect(workspacesStore.getState().workspaces[repo.id]).toBeDefined()
  })

  test('zen mode menu action toggles the zen mode state', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-worktree', { isPrimary: false, isLocked: false }),
      ],
    })
    currentWorkspaceId = repo.id

    await renderHookHost()

    expect(workspacesStore.getState().zenMode).toBe(false)
    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'workspace-zen-mode-toggle-requested' })
    })

    await waitFor(() => {
      expect(workspacesStore.getState().zenMode).toBe(true)
    })
  })

  test('current repo menu actions prefer the visible routed repo over restored repo id', async () => {
    const restoredRepo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/restored-repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/restored-repo-worktree', { isPrimary: false, isLocked: false }),
      ],
    })
    const visibleRepo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/visible-repo',
      currentBranch: 'feature',
      currentBranchName: 'feature',
      branchSnapshots: [createBranchSnapshot('feature')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature', '/tmp/visible-repo-worktree', {
          isPrimary: false,
          isLocked: false,
        }),
      ],
    })
    workspacesStore.setState((state) => ({
      ...state,
      workspaces: {
        [restoredRepo.id]: restoredRepo,
        [visibleRepo.id]: visibleRepo,
      },
      workspaceOrder: [restoredRepo.id, visibleRepo.id],
      restoredWorkspaceId: restoredRepo.id,
      workspaceMembershipReady: true,
    }))
    currentWorkspaceId = visibleRepo.id

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'close-workspace-requested' })
    })

    await waitFor(() => {
      expect(closeRepoSpy).toHaveBeenCalledWith(visibleRepo.id)
      expect(workspacesStore.getState().workspaces[visibleRepo.id]).toBeUndefined()
    })
    expect(workspacesStore.getState().workspaces[restoredRepo.id]).toBeDefined()
  })

  test('open-recent-workspace opens without store activation and then delegates activation to navigation', async () => {
    workspacesStore.setState({
      openWorkspaceMembership: vi.fn(async () => ({
        ok: true as const,
        workspaceId: workspaceIdForTest('goblin+file:///tmp/recent-workspace'),
      })),
    })

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) {
        listener({
          type: 'open-recent-workspace-requested',
          entry: { id: 'goblin+file:///tmp/recent-workspace' },
        })
      }
    })

    await waitFor(() => {
      expect(workspacesStore.getState().openWorkspaceMembership).toHaveBeenCalledWith({
        id: 'goblin+file:///tmp/recent-workspace',
      })
      expect(activateWorkspaceSpy).toHaveBeenCalledWith('goblin+file:///tmp/recent-workspace')
    })
  })

  test('does not let an earlier open-recent result replace a later navigation intent', async () => {
    const first = Promise.withResolvers<OpenWorkspaceResult>()
    const second = Promise.withResolvers<OpenWorkspaceResult>()
    const firstWorkspaceId = workspaceIdForTest('goblin+file:///tmp/first-recent-workspace')
    const secondWorkspaceId = workspaceIdForTest('goblin+file:///tmp/second-recent-workspace')
    workspacesStore.setState({
      openWorkspaceMembership: vi
        .fn()
        .mockImplementationOnce(async () => await first.promise)
        .mockImplementationOnce(async () => await second.promise),
    })

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) {
        listener({ type: 'open-recent-workspace-requested', entry: { id: firstWorkspaceId } })
        listener({ type: 'open-recent-workspace-requested', entry: { id: secondWorkspaceId } })
      }
    })
    second.resolve({ ok: true, workspaceId: secondWorkspaceId })
    await waitFor(() => expect(activateWorkspaceSpy).toHaveBeenCalledWith(secondWorkspaceId))
    first.resolve({
      ok: false,
      kind: 'uncertain',
      workspaceId: firstWorkspaceId,
      message: 'error.operation-outcome-uncertain',
    })
    await flushTestUpdates(() => {})

    expect(activateWorkspaceSpy).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('error.operation-outcome-uncertain', {
      id: 'workspace-open-outcome-uncertain',
    })
  })

  test('workspace view menu actions are suppressed while settings-like routes are active', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branchSnapshots: [createBranchSnapshot('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-worktree', { isPrimary: false, isLocked: false }),
      ],
    })
    currentWorkspaceId = repo.id
    workspaceShortcutSuppressed = true
    const defaultWorkspacePaneSize = workspacesStore.getState().workspacePaneSize
    workspacesStore.getState().setWorkspacePaneSize(defaultWorkspacePaneSize + 10)

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) {
        listener({ type: 'show-workspace-pane-tab-requested', tab: 'terminal' })
        listener({ type: 'terminal-primary-action-requested' })
        listener({ type: 'workspace-zen-mode-toggle-requested' })
        listener({ type: 'close-workspace-requested' })
        listener({ type: 'layout-reset-requested' })
      }
    })

    await waitFor(() => {
      expect(workspacesStore.getState().workspacePaneSize).toBe(defaultWorkspacePaneSize)
    })
    const state = workspacesStore.getState()
    expect(preferredWorkspacePaneTab(repo.id)).toBe('status')
    expect(state.zenMode).toBe(false)
    expect(closeRepoSpy).not.toHaveBeenCalled()
  })

  test('native new-terminal intent preserves a static route opener on a worktree target', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      branches: [createRepoBranch('main')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('main', '/tmp/repo-worktree', { isPrimary: false, isLocked: false }),
      ],
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
    currentFilesystemTarget = gitWorktreePaneFilesystemTarget({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: '/tmp/repo-worktree',
      head: { kind: 'branch', branchName: 'main' },
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(repo.id, repo.workspaceRuntimeId)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(repo.id, '/tmp/repo-worktree')
    let visibleSessionIds = ['term-111111111111111111111']
    let workspacePaneTabsTestBridge!: ReturnType<typeof installWorkspacePaneTabsTestBridge>
    workspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, 'term-111111111111111111111')
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-222222222222222222222'
      const coordinates = terminalSessionCoordinates(base)
      if (base.target.kind !== 'git-worktree') throw new Error('expected Git worktree terminal fixture')
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      workspacePaneTabsTestBridge.addRuntimeTab({
        workspaceId: coordinates.workspaceId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        worktreePath: terminalExecutionPath(base.target),
        terminalSessionId,
      })
      workspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, terminalSessionId)
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      setWorkspacePaneTabsForTargetQueryData({
        workspaceId: repo.id,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        branchName: 'main',
        worktreePath: '/tmp/repo-worktree',
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('history'),
          ...visibleSessionIds.map((id) => workspacePaneRuntimeTabEntry('terminal', id)),
        ],
      })
      return Promise.resolve({ kind: 'committed' as const, projection: 'applied' as const })
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () =>
        terminalFilesystemTargetSnapshot(terminalFilesystemTargetKey, visibleSessionIds),
      createTerminal,
      createTerminalWithAdmission: vi.fn(async (base) => ({
        terminalSessionId: await createTerminal(base),
        presentation: base.presentation,
        requestRole: 'leader' as const,
        resourceDisposition: 'created' as const,
        runtimeProjectionApplied: true,
      })),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
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
    renderInJsdom(<HookHost />)
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'main',
      worktreePath: '/tmp/repo-worktree',
      route: { kind: 'static', tab: 'status' },
    })

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'terminal-new-tab-requested' })
    })

    await waitFor(() => {
      expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          routeTarget: { kind: 'git-worktree', workspaceId: repo.id, worktreePath: '/tmp/repo-worktree' },
        }),
        { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' },
      )
    })
  })

  test('drains externally opened repo paths through the centralized intent router', async () => {
    workspacesStore.setState({
      openWorkspaceMembership: vi.fn(async (path: string | { id: string }) => ({
        ok: true as const,
        workspaceId: workspaceIdForTest(typeof path === 'string' ? path : path.id),
      })),
    })
    consumeExternalOpenPathsSpy
      .mockResolvedValueOnce(['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'] as string[])
      .mockResolvedValueOnce([] as string[])

    await renderHookHost()
    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'external-open-enqueued' })
    })

    await waitFor(() => {
      expect(workspacesStore.getState().openWorkspaceMembership).toHaveBeenCalledWith('goblin+file:///tmp/repo-a')
      expect(workspacesStore.getState().openWorkspaceMembership).toHaveBeenCalledWith('goblin+file:///tmp/repo-b')
      expect(activateWorkspaceSpy).toHaveBeenCalledWith('goblin+file:///tmp/repo-a')
    })
  })

  test('does not drain startup external paths before bootstrap admission', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    await renderHookHost()
    await flushTestUpdates(() => {})
    expect(consumeExternalOpenPathsSpy).not.toHaveBeenCalled()

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'ready' }
    })
    await waitFor(() => expect(consumeExternalOpenPathsSpy).toHaveBeenCalledOnce())
  })

  test('theme menu intents update theme through the client store', async () => {
    const setPref = vi.fn(async () => {})
    themeStore.setState((state) => ({ ...state, setPref }))

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'theme-pref-set-requested', pref: 'dark' })
    })

    await waitFor(() => {
      expect(setPref).toHaveBeenCalledWith('dark')
    })
  })

  test('does not block an unrelated dialog behind a pending settings intent', async () => {
    const write = Promise.withResolvers<void>()
    themeStore.setState((state) => ({ ...state, setPref: vi.fn(async () => await write.promise) }))
    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) {
        listener({ type: 'theme-pref-set-requested', pref: 'dark' })
        listener({ type: 'open-workspace-path-requested' })
      }
    })

    expect(openWorkspacePathDialogSpy).toHaveBeenCalledOnce()
    write.resolve()
  })

  test('language menu intents update i18n through the client store', async () => {
    const setPref = vi.fn(async () => {})
    i18nStore.setState((state) => ({ ...state, setPref }))

    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'lang-pref-set-requested', pref: 'ko' })
    })

    await waitFor(() => {
      expect(setPref).toHaveBeenCalledWith('ko')
    })
  })

  test('clear recent intent clears server-backed recents through the client', async () => {
    await renderHookHost()

    await flushTestUpdates(() => {
      for (const listener of intentListeners) listener({ type: 'clear-recent-workspaces-requested' })
    })

    await waitFor(() => {
      expect(appDataClientMocks.clearRecentWorkspaceHistory).toHaveBeenCalledTimes(1)
    })
  })
})

function preferredWorkspacePaneTab(repoId: string) {
  const repo = workspacesStore.getState().workspaces[repoId]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          {
            workspaceId: repo.id,
            branches: repoPresentationFromQueryForTest(repo).snapshot.branches,
            worktrees: repoPresentationFromQueryForTest(repo).snapshot.worktrees,
          },
          'main',
        ),
      )
    : null
}

async function renderHookHost() {
  return renderInJsdom(<HookHost />)
}

const HookHost = defineComponent({
  name: 'ClientEffectIntentRouterTestHost',
  setup() {
    useClientEffectIntentRouter({
      authenticatedBootstrapState,
      navigation: () => navigation,
      currentWorkspaceId: () => currentWorkspaceId,
      currentWorkspacePaneCommandTarget,
      closeAllOverlays,
      openWorkspacePathDialog: openWorkspacePathDialogSpy,
      openCloneRepo: openCloneRepoSpy,
      openRemoteWorkspace: openRemoteWorkspaceSpy,
      openCreateWorktree: () => {},
      isOverlayOpen: () => overlayOpen,
      isWorkspaceShortcutSuppressed: () => workspaceShortcutSuppressed,
    })
    return () => null
  },
})

function currentWorkspacePaneCommandTarget(): WorkspacePaneCommandTarget | null {
  if (!currentBranchName || !currentWorkspaceId) return null
  const workspace = workspacesStore.getState().workspaces[currentWorkspaceId]
  if (!workspace) return null
  if (currentFilesystemTarget?.kind === 'git-worktree') {
    return {
      workspacePaneRoute: currentWorkspacePaneRoute,
      filesystemTarget: currentFilesystemTarget,
    }
  }
  if (currentWorkspacePaneRoute?.kind === 'terminal') {
    throw new Error('branch command target cannot present a runtime tab')
  }
  return {
    routeTarget: { kind: 'git-branch', workspaceId: currentWorkspaceId, branchName: currentBranchName },
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    workspacePaneRoute: currentWorkspacePaneRoute,
    filesystemTarget: null,
  }
}

function terminalFilesystemTargetSnapshot(
  terminalFilesystemTargetKey: string,
  terminalSessionIds: readonly string[],
): TerminalFilesystemTargetSnapshot {
  const selectedKey =
    workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey] ?? null
  const sessions = terminalSessionIds.map((terminalSessionId, index) => ({
    type: 'terminal' as const,
    terminalSessionId,
    terminalFilesystemTargetKey,
    index: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: terminalSessionId === selectedKey,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedSession = sessions.find((session) => session.terminalSessionId === selectedKey) ?? null
  return {
    terminalFilesystemTargetKey,
    selectedDescriptor: selectedSession
      ? {
          terminalSessionId: selectedSession.terminalSessionId,
          index: selectedSession.index,
          target: {
            kind: 'git-worktree' as const,
            workspaceId: canonicalWorkspaceLocator('goblin+file:///tmp/repo')!,
            workspaceRuntimeId:
              workspacesStore.getState().workspaces['goblin+file:///tmp/repo']?.workspaceRuntimeId ?? '',
            root: canonicalWorkspaceLocator('goblin+file:///tmp/repo-worktree')!,
          },
          presentation: { kind: 'git-worktree' as const },
        }
      : null,
    sessions,
    count: sessions.length,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}
