// @vitest-environment jsdom

import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
} from '#/shared/workspace-pane.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import {
  dispatchCloseWorkspacePaneTabAction,
  dispatchConfirmCloseTerminalWorkspacePaneTabAction,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  observedAppNavigationActionsForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type AppNavigationOverridesForTest,
  observeWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  runtimeWorkspacePaneTargetForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import {
  claimTerminalAutoFocus,
  fulfillTerminalPresentationFocus,
  resetTerminalAutoFocusForTest,
} from '#/web/terminal-focus.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  registerAppNavigation,
  resetAppNavigationForTest,
} from '#/web/app-navigation-lifecycle.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { writeWorkspacePaneTabsSnapshotQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

const feedbackMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))

vi.mock('vue-sonner', () => ({ toast: { error: feedbackMocks.error, warning: feedbackMocks.warning } }))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-close-repo')
const BRANCH_NAME = 'feature/worktree-close'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-close-worktree'
const WORKTREE_PANE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: REPO_ID,
  worktreePath: WORKTREE_PATH,
}

beforeEach(() => {
  feedbackMocks.error.mockClear()
  feedbackMocks.warning.mockClear()
  resetTerminalAutoFocusForTest()
  resetAppNavigationForTest()
  resetWorkspacePaneActionQueueForTest()
  appQueryClient.clear()
  resetWorkspacesStore()
  setTerminalSessionCommandBridge(null)
  installWorkspacePaneTabsTestBridge()
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  resetTerminalAutoFocusForTest()
  resetAppNavigationForTest()
})

describe('workspace pane tab close action', () => {
  test('commits active close-back route through command-owned navigation', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })
    const commitWorkspacePaneRoute = vi.fn(navigation.commitWorkspacePaneRoute)
    navigation.commitWorkspacePaneRoute = commitWorkspacePaneRoute
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    await expect(
      dispatchCloseWorkspacePaneTabAction({
        routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: BRANCH_NAME },
        paneTarget: WORKTREE_PANE_TARGET,
        worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
        workspaceId: REPO_ID,
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        navigation,
        presentationEffects,
      }),
    ).resolves.toBe(true)

    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      { kind: 'static', tab: 'status' },
      expect.objectContaining({ navigationGeneration: expect.any(Number) }),
    )
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'status')
    expect(presentationEffects.onCommit).toHaveBeenCalledOnce()
    expect(presentationEffects.onAbandon).not.toHaveBeenCalled()
  })

  test('keeps a branch-headed worktree close in the worktree route family', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      status: [{ path: WORKTREE_PATH, branch: BRANCH_NAME, isMain: false, entries: [] }],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
      },
    })
    const commitWorkspacePaneRoute = vi.fn(async () => true)
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async (_target, _route, options) => {
        options?.onCommit?.()
        return true
      },
    )

    await expect(
      dispatchCloseWorkspacePaneTabAction({
        routeTarget: WORKTREE_PANE_TARGET,
        paneTarget: WORKTREE_PANE_TARGET,
        worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
        workspaceId: REPO_ID,
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute, commitWorkspacePaneRoute }),
      }),
    ).resolves.toBe(true)

    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        routeTarget: WORKTREE_PANE_TARGET,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        authority: { kind: 'branch', branchName: BRANCH_NAME },
      },
      { kind: 'static', tab: 'status' },
      expect.objectContaining({
        routePrecondition: { kind: 'exact-route', route: { kind: 'static', tab: 'files' } },
      }),
    )
  })

  test('closes a workspace-root static tab through the shared tab transaction', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const target = {
      kind: 'workspace-root' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'status')
    const updateWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('files')])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })

    await expect(
      dispatchCloseWorkspacePaneTabAction({
        routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        workspaceId: REPO_ID,
        workspacePaneRoute: undefined,
        navigation: navigationWith(),
      }),
    ).resolves.toBe(true)

    expect(updateWorkspaceTabs).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      target: {
        kind: 'workspace-root',
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      },
      operation: { type: 'close-static', tabType: 'status' },
    })
  })

  test('stops close presentation when a newer pane projection supersedes the accepted response', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const target = {
      kind: 'workspace-root' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    const sourceTabs = [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')]
    setWorkspacePaneTabsForTargetQueryData({ ...target, tabs: sourceTabs })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'status')
    const requestStarted = Promise.withResolvers<void>()
    const response = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        requestStarted.resolve()
        return await response.promise
      },
    })
    const commitWorkspacePaneRoute = vi.fn(async () => true)
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    const close = dispatchCloseWorkspacePaneTabAction({
      routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
      paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
      workspaceId: REPO_ID,
      workspacePaneRoute: undefined,
      navigation: navigationWith({ commitWorkspacePaneRoute }),
      presentationEffects,
    })
    await requestStarted.promise
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ID, repo.workspaceRuntimeId, {
      revision: 99,
      entries: [{ target: runtimeWorkspacePaneTargetForTest(target), tabs: sourceTabs }],
    })
    response.resolve([workspacePaneStaticTabEntry('files')])

    await expect(close).resolves.toBe(true)
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
    expect(feedbackMocks.error).not.toHaveBeenCalled()
    expect(feedbackMocks.warning).not.toHaveBeenCalled()
  })

  test.each([
    {
      label: 'a rejected mutation',
      failure: new Error('error.workspace-runtime-stale'),
      feedback: 'error' as const,
      messageKey: 'error.workspace-runtime-stale',
      toastId: 'workspace-pane-tab-close-failed',
    },
    {
      label: 'an indeterminate transport outcome',
      failure: new ClientRealtimeRequestError('response was lost', {
        kind: 'timeout',
        delivery: 'indeterminate',
        outageId: 1,
      }),
      feedback: 'warning' as const,
      messageKey: 'error.workspace-tabs-outcome-uncertain',
      toastId: 'workspace-pane-tabs-outcome-uncertain',
    },
    {
      label: 'a transport failure before delivery',
      failure: new ClientRealtimeRequestError('request was not sent', {
        kind: 'send-failed',
        delivery: 'not-sent',
        outageId: null,
      }),
      feedback: 'error' as const,
      messageKey: 'error.workspace-operation-failed',
      toastId: 'workspace-pane-tab-close-failed',
    },
  ])('stops static tab close automation and surfaces recovery for $label', async (input) => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const target = {
      kind: 'workspace-root' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'status')
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw input.failure
      },
    })
    const commitWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      dispatchCloseWorkspacePaneTabAction({
        routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        workspaceId: REPO_ID,
        workspacePaneRoute: undefined,
        navigation: navigationWith({ commitWorkspacePaneRoute }),
      }),
    ).resolves.toBe(false)

    expect(feedbackMocks[input.feedback]).toHaveBeenCalledWith(input.messageKey, { id: input.toastId })
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('carries automatic focus from active close through route commit and mount transfer', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const target = {
      kind: 'workspace-root' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'files')
    const lifecycle = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: vi.fn(async () => await lifecycle.promise) })
    const bridgeFocus = installPendingTerminalFocusBridge()
    const routeCommit = Promise.withResolvers<void>()
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async (_target, _route, options) => {
        await routeCommit.promise
        options?.onCommit?.()
        return true
      },
    )
    const close = dispatchCloseWorkspacePaneTabAction({
      routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
      paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
      workspaceId: REPO_ID,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
    })

    lifecycle.resolve([workspacePaneRuntimeTabEntry('terminal', terminalSessionId)])
    await vi.waitFor(() => expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce())
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        workspaceRuntimeId: repo.workspaceRuntimeId,
        authority: { kind: 'workspace-runtime' },
      },
      { kind: 'terminal', terminalSessionId },
      expect.objectContaining({
        routePrecondition: { kind: 'exact-route', route: { kind: 'static', tab: 'files' } },
      }),
    )
    routeCommit.resolve()
    await expect(close).resolves.toBe(true)
    expect(bridgeFocus).toHaveBeenCalledWith(
      terminalSessionId,
      expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
    )
    const mountedFocus = vi.fn(
      (_terminalSessionId: string, _request: { isCurrent: () => boolean; onSettled: () => void }) => true,
    )
    fulfillTerminalPresentationFocus(terminalSessionId, mountedFocus)
    expect(mountedFocus).toHaveBeenCalledOnce()
    const mountedRequest = mountedFocus.mock.calls[0]![1]
    expect(mountedRequest.isCurrent()).toBe(true)
    mountedRequest.onSettled()
  })

  test('releases terminal focus when active close lifecycle fails', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const target = {
      kind: 'workspace-root' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'files')
    const lifecycle = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    const updateWorkspaceTabs = vi.fn(async () => await lifecycle.promise)
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    installPendingTerminalFocusBridge()
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async () => true,
    )
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }
    const close = dispatchCloseWorkspacePaneTabAction({
      routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
      paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
      workspaceId: REPO_ID,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
      presentationEffects,
    })

    await vi.waitFor(() => expect(updateWorkspaceTabs).toHaveBeenCalledOnce())
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()

    lifecycle.reject(new Error('simulated close failure'))
    await expect(close).resolves.toBe(false)

    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
    const nextPresentation = beginAppNavigation()
    const nextFocusLease = claimTerminalAutoFocus(nextPresentation)
    expect(nextFocusLease).not.toBeNull()
    nextFocusLease?.release()
  })

  test('reports lifecycle success and clears the transition when close-back navigation rejects', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
      },
    })
    const routeCommit = Promise.withResolvers<boolean>()
    const commitWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }
    const close = dispatchCloseWorkspacePaneTabAction({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: BRANCH_NAME },
      paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
      workspaceId: REPO_ID,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation: navigationWith({ commitWorkspacePaneRoute }),
      presentationEffects,
    })

    await vi.waitFor(() => expect(commitWorkspacePaneRoute).toHaveBeenCalledOnce())

    routeCommit.reject(new Error('navigation failed'))
    await expect(close).resolves.toBe(true)
    expect(feedbackMocks.warning).toHaveBeenCalledWith('error.workspace-tabs-committed-projection-failed', {
      id: 'workspace-pane-tab-close-projection-failed',
    })
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
  })

  test('abandons superseded close presentation without reporting the committed close as failed', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
      },
    })
    const commitWorkspacePaneRoute = vi.fn(async () => false)
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    await expect(
      dispatchCloseWorkspacePaneTabAction({
        routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: BRANCH_NAME },
        paneTarget: WORKTREE_PANE_TARGET,
        worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
        workspaceId: REPO_ID,
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        navigation: navigationWith({ commitWorkspacePaneRoute }),
        presentationEffects,
      }),
    ).resolves.toBe(true)

    expect(commitWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
    expect(feedbackMocks.error).not.toHaveBeenCalled()
    expect(feedbackMocks.warning).not.toHaveBeenCalled()
  })

  test('preserves the authoritative close when a detached terminal commits without a current projection', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [
          workspacePaneRuntimeTabEntry('terminal', terminalSessionId),
          workspacePaneStaticTabEntry('status'),
        ],
      },
    })
    const terminalFilesystemTargetKey = `${REPO_ID}\0${WORKTREE_PATH}`
    const runtimeTarget = runtimeWorkspacePaneTargetForTest({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
    })
    const closeTerminalByDescriptor = vi.fn(async () => ({ kind: 'committed' as const, projection: 'failed' as const }))
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey,
        selectedDescriptor: {
          terminalSessionId,
          terminalFilesystemTargetKey,
          index: 1,
          target: runtimeTarget,
          presentation: { kind: 'git-worktree' as const, head: { kind: 'detached' as const } },
        },
        sessions: [
          {
            type: 'terminal',
            terminalSessionId,
            terminalFilesystemTargetKey,
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
      }),
      createTerminal: vi.fn(async () => terminalSessionId),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor,
    })
    const route = { kind: 'terminal' as const, terminalSessionId }
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const navigation = navigationWith({ commitFilesystemWorkspacePaneRoute })
    expect(
      recordWorkspacePaneTabOpener(
        WORKTREE_PANE_TARGET,
        repo.workspaceRuntimeId,
        `terminal:${terminalSessionId}`,
        'workspace-pane:status',
      ),
    ).toBe('recorded')

    await expect(
      dispatchConfirmCloseTerminalWorkspacePaneTabAction({
        routeTarget: WORKTREE_PANE_TARGET,
        paneTarget: WORKTREE_PANE_TARGET,
        worktreeHead: { kind: 'detached' },
        workspaceId: REPO_ID,
        workspacePaneRoute: route,
        navigation,
        currentWorkspacePaneRoute: route,
        confirmedTerminal: {
          terminalSessionId,
          base: {
            target: runtimeTarget,
            presentation: { kind: 'git-worktree' as const, head: { kind: 'detached' as const } },
          },
        },
        presentationEffects,
      }),
    ).resolves.toBe(true)
    expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()
    expect(presentationEffects.onCommit).toHaveBeenCalledOnce()
    expect(presentationEffects.onAbandon).not.toHaveBeenCalled()
    expect(feedbackMocks.warning).toHaveBeenCalledWith('error.workspace-tabs-committed-projection-failed', {
      id: 'workspace-pane-tab-close-projection-failed',
    })
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(
      workspacePaneTabOpener(WORKTREE_PANE_TARGET, repo.workspaceRuntimeId, `terminal:${terminalSessionId}`),
    ).toBeNull()
  })

  test('derives a detached worktree terminal close target through the production dispatch path', async () => {
    const terminalSessionId = 'term-222222222222222222222'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      status: [{ path: WORKTREE_PATH, isMain: false, entries: [] }],
      currentBranchName: null,
    })
    const paneTarget = {
      ...WORKTREE_PANE_TARGET,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    const runtimeTarget = runtimeWorkspacePaneTargetForTest(paneTarget)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKey(REPO_ID, runtimeTarget.root)
    setWorkspacePaneTabsForTargetQueryData({
      ...paneTarget,
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId), workspacePaneStaticTabEntry('status')],
    })
    const closeTerminalByDescriptor = vi.fn(async () => ({
      kind: 'committed' as const,
      projection: 'applied' as const,
    }))
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal: vi.fn(async () => terminalSessionId),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor,
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async (_target, _route, options) => {
        options?.onCommit?.()
        return true
      },
    )

    await expect(
      dispatchCloseWorkspacePaneTabAction({
        routeTarget: WORKTREE_PANE_TARGET,
        paneTarget: WORKTREE_PANE_TARGET,
        worktreeHead: { kind: 'detached' },
        workspaceId: REPO_ID,
        workspacePaneRoute: { kind: 'terminal', terminalSessionId },
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
        skipRuntimeCloseConfirm: true,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith(terminalSessionId, {
      target: runtimeTarget,
      presentation: { kind: 'git-worktree', head: { kind: 'detached' } },
    })
    expect(closeTerminalByDescriptor).not.toHaveBeenCalledWith(
      terminalSessionId,
      expect.objectContaining({
        target: expect.objectContaining({ kind: 'workspace-root' }),
      }),
    )
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        routeTarget: WORKTREE_PANE_TARGET,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        authority: { kind: 'detached-worktree' },
      },
      { kind: 'static', tab: 'status' },
      expect.objectContaining({
        routePrecondition: {
          kind: 'exact-route',
          route: { kind: 'terminal', terminalSessionId },
        },
      }),
    )
  })

  test('confirmed workspace terminal close selects Files without inventing a branch route', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const targetInput = {
      kind: 'workspace-root' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    const runtimeTarget = runtimeWorkspacePaneTargetForTest(targetInput)
    setWorkspacePaneTabsForTargetQueryData({
      ...targetInput,
      tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(targetInput, 'terminal')
    workspacesStore
      .getState()
      .setSelectedTerminal(formatTerminalFilesystemTargetKey(REPO_ID, REPO_ID), terminalSessionId)
    const terminalFilesystemTargetKey = `${REPO_ID}\0${REPO_ID}`
    const closeTerminalByDescriptor = vi.fn(async () => ({
      kind: 'committed' as const,
      projection: 'applied' as const,
    }))
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey,
        selectedDescriptor: {
          terminalSessionId,
          terminalFilesystemTargetKey,
          index: 1,
          target: runtimeTarget,
          presentation: { kind: 'workspace-root' },
        },
        sessions: [
          {
            type: 'terminal',
            terminalSessionId,
            terminalFilesystemTargetKey,
            index: 1,
            title: 'node',
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
      }),
      createTerminal: vi.fn(async () => terminalSessionId),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor,
    })
    const targetKey = workspacePaneTabsTargetIdentityKey(targetInput)
    expect(workspacesStore.getState().workspaces[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe(
      'terminal',
    )
    expect(
      workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[
        formatTerminalFilesystemTargetKey(REPO_ID, REPO_ID)
      ],
    ).toBe(terminalSessionId)
    const navigation = navigationWith({
      commitFilesystemWorkspacePaneRoute: vi.fn(async (_target, route, options) => {
        if (route?.kind === 'static') {
          workspacesStore.getState().setWorkspacePaneTabForTarget(targetInput, route.tab)
        }
        options?.onCommit?.()
        return true
      }),
    })
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    await expect(
      dispatchConfirmCloseTerminalWorkspacePaneTabAction({
        routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        workspaceId: REPO_ID,
        workspacePaneRoute: undefined,
        navigation,
        currentWorkspacePaneRoute: null,
        selectedIdentity: `terminal:${terminalSessionId}`,
        confirmedTerminal: {
          terminalSessionId,
          base: {
            target: runtimeTarget,
            presentation: { kind: 'workspace-root' },
          },
        },
        presentationEffects,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()
    expect(presentationEffects.onCommit).toHaveBeenCalledOnce()
    expect(presentationEffects.onAbandon).not.toHaveBeenCalled()
    expect(workspacesStore.getState().workspaces[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe(
      'files',
    )
  })

  test('does not let a late close from an old runtime navigate or clear the replacement runtime opener', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
      },
    })
    const serverClose = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    const updateWorkspaceTabs = vi.fn(async () => await serverClose.promise)
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    expect(
      recordWorkspacePaneTabOpener(
        WORKTREE_PANE_TARGET,
        repo.workspaceRuntimeId,
        'workspace-pane:files',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'files' },
    })
    const navigation = navigationWith()
    const close = dispatchCloseWorkspacePaneTabAction({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: BRANCH_NAME },
      paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
      workspaceId: REPO_ID,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation,
    })
    await vi.waitFor(() => expect(updateWorkspaceTabs).toHaveBeenCalledOnce())

    const replacementRuntimeId = 'repo-runtime-replacement'
    const replacementRepo = { ...repo, workspaceRuntimeId: replacementRuntimeId }
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: replacementRepo,
      },
    }))
    seedRepoQueryDataForTest(replacementRepo, {
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranch: BRANCH_NAME,
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: replacementRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
    })
    expect(
      recordWorkspacePaneTabOpener(
        WORKTREE_PANE_TARGET,
        replacementRuntimeId,
        'workspace-pane:files',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: replacementRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'files' },
    })

    serverClose.resolve([workspacePaneStaticTabEntry('status')])
    await expect(close).resolves.toBe(true)
    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(WORKTREE_PANE_TARGET, replacementRuntimeId, 'workspace-pane:files')).toBe(
      'workspace-pane:status',
    )
  })
})

function navigationWith(overrides: AppNavigationOverridesForTest = {}): AppNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  return observedAppNavigationActionsForTest({
    activateWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
    cycleWorkspace: vi.fn(),
    selectRepoBranch: vi.fn(() => true),
    showRepoBranchEmptyWorkspacePane: vi.fn(() => true),
    showRepoBranchWorkspacePaneTab: vi.fn(() => true),
    showRepoBranchTerminalSession: vi.fn(() => true),
    showWorkspaceRootPaneTab: vi.fn((_repoId, _presentation, options) => {
      options?.onCommit?.()
      return true
    }),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
    ...overrides,
  })
}

function installPendingTerminalFocusBridge() {
  const focusTerminal = vi.fn(() => false)
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
    createTerminal: vi.fn(async () => 'term-111111111111111111111'),
    createTerminalWithAdmission: vi.fn(async () => {
      throw new Error('unexpected terminal creation')
    }),
    selectTerminal: vi.fn(),
    focusTerminal,
    closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
  })
  return focusTerminal
}
