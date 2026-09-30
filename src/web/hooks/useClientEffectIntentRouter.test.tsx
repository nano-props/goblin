// @vitest-environment jsdom
import {
  workspacePaneLocationForBranchTarget,
  workspacePaneLocationForLinkedWorktree,
  workspacePaneLocationForRoot,
} from '#/web/workspace-pane/workspace-pane-location.ts'
import {
  createRepoWorktreeSnapshotForTest,
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
import { setClientBridgeForTests } from '#/web/bridge/client.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import {
  observedAppNavigationActionsForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type ObservedAppNavigationActionsForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { repoPresentationFromQueryForTest } from '#/web/test-utils/repo-store.ts'
import { setTerminalSessionCommandBridge } from '#/web/terminal/components/terminal-session-command-bridge.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/app/bootstrap/authenticated.ts'
import { workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneFilesystemRootPath,
  type WorkspacePaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

vi.mock('#/web/realtime/client-intent-ingress.ts', () => ({
  subscribeServerClientIntentIngress: (cb: (event: ClientEffectIntent) => void) => {
    serverIntentSubscriptionStarts += 1
    intentListeners.add(cb)
    return () => {
      intentListeners.delete(cb)
    }
  },
}))

const intentListeners = new Set<(event: ClientEffectIntent) => void>()
let serverIntentSubscriptionStarts = 0
const closeAllOverlays = vi.fn()
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
const commitFilesystemWorkspacePaneRouteSpy = vi.fn()

beforeEach(() => {
  resetWorkspacesStore()
  setClientBridgeForTests(null)
  closeAllOverlays.mockClear()
  activateWorkspaceSpy.mockClear()
  closeRepoSpy.mockClear()
  showRepoBranchWorkspacePaneTabSpy.mockClear()
  commitFilesystemWorkspacePaneRouteSpy.mockClear()
  overlayOpen = false
  workspaceShortcutSuppressed = false
  currentWorkspaceId = null
  authenticatedBootstrapState.value = { status: 'ready' }
  currentBranchName = null
  currentWorkspacePaneRoute = null
  currentFilesystemTarget = null
  serverIntentSubscriptionStarts = 0
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
  setTerminalSessionCommandBridge(null)
  navigation = observedAppNavigationActionsForTest({
    currentWorkspacePaneRoute: () => undefined,
    activateWorkspace: (repoId) => {
      activateWorkspaceSpy(repoId)
    },
    closeWorkspace: (repoId) => {
      closeRepoSpy(repoId)
      return workspacesStore.getState().closeWorkspace(repoId)
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
    commitFilesystemWorkspacePaneRoute: (location, route, options) => {
      commitFilesystemWorkspacePaneRouteSpy(location, route)
      options?.onCommit?.()
      return Promise.resolve(true)
    },
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
  })
})

function readyFilesystemWorkspace(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  const workspace = emptyWorkspace(workspaceId, workspaceRuntimeId)
  acceptWorkspaceProbeState(workspace, {
    status: 'ready',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    },
    diagnostics: [],
  })
  return workspace
}

function emitIntent(event: ClientEffectIntent) {
  for (const listener of intentListeners) listener(event)
}

afterEach(() => {
  intentListeners.clear()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

describe('useClientEffectIntentRouter', () => {
  test('admits a cold-start terminal bell only after bootstrap restores its workspace authority', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const workspaceRuntimeId = 'workspace-runtime-test'
    const terminalSessionId = 'term-111111111111111111111'
    await renderHookHost()

    await flushTestUpdates(() => {
      emitIntent({
        type: 'terminal-bell-click',
        terminalSessionId,
        session: {
          target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId },
          presentation: { kind: 'workspace-root' },
        },
      })
    })
    expect(commitFilesystemWorkspacePaneRouteSpy).not.toHaveBeenCalled()

    const workspace = readyFilesystemWorkspace(workspaceId, workspaceRuntimeId)
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
        workspacePaneLocationForRoot(workspaceId, workspaceRuntimeId),
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
      emitIntent({ type: 'show-workspace-pane-tab-requested', tab: 'history' })
    })

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'failed', message: 'restore failed for test' }
    })
    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('workspace-restore.failed')

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'restoring-workspace' }
      authenticatedBootstrapState.value = { status: 'ready' }
    })
    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
  })

  test('does not retain a workspace-only intent when the ready route has no workspace target', async () => {
    currentWorkspaceId = null
    const host = await renderHookHost()
    await flushTestUpdates(() => {
      emitIntent({ type: 'show-workspace-pane-tab-requested', tab: 'history' })
    })

    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      currentBranch: 'main',
      currentBranchName: 'main',
    })
    currentWorkspaceId = repo.id
    await flushTestUpdates(() => host.rerender(<IntentIngressTestHost />))

    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
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
    installWorkspacePaneTabsTestBridge({})
    const host = await renderHookHost()

    expect(serverIntentSubscriptionStarts).toBe(1)
    expect(intentListeners.size).toBe(1)

    currentWorkspaceId = repo.id
    currentBranchName = 'main'
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
    await flushTestUpdates(async () => {
      await host.rerender(<IntentIngressTestHost />)
    })

    expect(serverIntentSubscriptionStarts).toBe(1)
    expect(intentListeners.size).toBe(1)

    await flushTestUpdates(() => {
      emitIntent({ type: 'show-workspace-pane-tab-requested', tab: 'history' })
    })

    await waitFor(() => {
      expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: repo.id }),
        { kind: 'static', tab: 'history' },
      )
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

    await flushTestUpdates(() => {
      emitIntent({
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
    const workspace = readyFilesystemWorkspace(workspaceId, 'workspace-runtime-test')
    workspacesStore.setState({ workspaces: { [workspaceId]: workspace }, workspaceOrder: [workspaceId] })
    const terminalSessionId = 'term-111111111111111111111'
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })

    await renderHookHost()
    await flushTestUpdates(() => {
      emitIntent({
        type: 'terminal-bell-click',
        terminalSessionId,
        session: {
          target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: workspace.workspaceRuntimeId },
          presentation: { kind: 'workspace-root' },
        },
      })
    })

    expect(commitFilesystemWorkspacePaneRouteSpy).toHaveBeenCalledWith(
      workspacePaneLocationForRoot(workspaceId, workspace.workspaceRuntimeId),
      { kind: 'terminal', terminalSessionId },
    )
  })

  test('workspace view commands are suppressed while settings-like routes are active', async () => {
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

    await renderHookHost()

    await flushTestUpdates(() => {
      emitIntent({ type: 'show-workspace-pane-tab-requested', tab: 'terminal' })
      emitIntent({ type: 'show-workspace-pane-tab-requested', tab: 'history' })
    })

    const state = workspacesStore.getState()
    expect(preferredWorkspacePaneTab(repo.id)).toBe('status')
    expect(state.zenMode).toBe(false)
    expect(showRepoBranchWorkspacePaneTabSpy).not.toHaveBeenCalled()
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
  return renderInJsdom(<IntentIngressTestHost />)
}

const IntentIngressTestHost = defineComponent({
  name: 'ClientEffectIntentIngressTestHost',
  setup() {
    return () => <HookHost />
  },
})

const HookHost = defineComponent({
  name: 'ClientEffectIntentRouterTestHost',
  setup() {
    useClientEffectIntentRouter({
      authenticatedBootstrapState,
      navigation: () => navigation,
      currentWorkspaceId: () => currentWorkspaceId,
      currentWorkspacePaneCommandTarget,
      closeAllOverlays,
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
      location: workspacePaneLocationForLinkedWorktree(
        {
          kind: 'git-worktree',
          workspaceId: currentFilesystemTarget.workspaceId,
          worktreePath: workspacePaneFilesystemRootPath(currentFilesystemTarget),
        },
        currentFilesystemTarget.workspaceRuntimeId,
        currentFilesystemTarget.head,
      ),
      workspacePaneRoute: currentWorkspacePaneRoute,
      capabilities: currentFilesystemTarget.capabilities,
    }
  }
  if (currentWorkspacePaneRoute?.kind === 'terminal') {
    throw new Error('branch command target cannot present a runtime tab')
  }
  return {
    location: workspacePaneLocationForBranchTarget(
      { kind: 'git-branch', workspaceId: currentWorkspaceId, branchName: currentBranchName },
      workspace.workspaceRuntimeId,
    ),
    workspacePaneRoute: currentWorkspacePaneRoute,
  }
}
