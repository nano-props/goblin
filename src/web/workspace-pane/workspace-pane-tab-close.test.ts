// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
} from '#/shared/workspace-pane.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  dispatchCloseWorkspacePaneTabAction,
  dispatchConfirmCloseTerminalWorkspacePaneTabAction,
} from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridgeForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import {
  observedPrimaryWindowNavigationActionsForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { observeWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  runtimeWorkspacePaneTargetForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import {
  claimTerminalInputFocus,
  fulfillTerminalPresentationFocus,
  TERMINAL_INPUT_FOCUS_SINK_ID,
  terminalOwnsKeyboardInput,
} from '#/web/terminal-focus.ts'
import {
  beginPrimaryWindowPresentation,
  resetPrimaryWindowPresentationForTest,
} from '#/web/primary-window-presentation.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-close-repo')
const BRANCH_NAME = 'feature/worktree-close'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-close-worktree'
const WORKTREE_PANE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: REPO_ID,
  worktreePath: WORKTREE_PATH,
}

beforeEach(() => {
  resetPrimaryWindowPresentationForTest()
  resetWorkspacePaneActionQueueForTest()
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  setTerminalSessionCommandBridgeForTest(null)
  installWorkspacePaneTabsTestBridge()
  const focusSink = document.createElement('div')
  focusSink.id = TERMINAL_INPUT_FOCUS_SINK_ID
  focusSink.tabIndex = -1
  document.body.appendChild(focusSink)
})

afterEach(() => {
  setTerminalSessionCommandBridgeForTest(null)
  document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)?.remove()
  resetPrimaryWindowPresentationForTest()
})

test('commits active close-back route through command-owned navigation', async () => {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
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

  await expect(
    dispatchCloseWorkspacePaneTabAction({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: BRANCH_NAME },
      paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
      workspaceId: REPO_ID,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation,
    }),
  ).resolves.toBe(true)

  expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
    REPO_ID,
    BRANCH_NAME,
    { kind: 'static', tab: 'status' },
    expect.objectContaining({ presentationToken: expect.any(Object) }),
  )
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'status')
})

test('keeps a branch-headed worktree close in the worktree route family', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    status: [{ path: WORKTREE_PATH, branch: BRANCH_NAME, isMain: false, entries: [] }],
    currentBranchName: BRANCH_NAME,
    preferredWorkspacePaneTab: 'files',
    workspacePaneTabsByBranch: {
      [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
    },
  })
  const commitWorkspacePaneRoute = vi.fn(async () => true)
  const commitFilesystemWorkspacePaneRoute = vi.fn<
    PrimaryWindowNavigationActions['commitFilesystemWorkspacePaneRoute']
  >(async (_target, _route, options) => {
    options?.onCommit?.()
    return true
  })

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
  useWorkspacesStore.getState().setWorkspacePaneTabForTarget(target, 'status')
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

test('holds terminal keyboard ownership from active close through route commit and mount transfer', async () => {
  const terminalSessionId = 'term-111111111111111111111'
  const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
  useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
  const target = {
    kind: 'workspace-root' as const,
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
  }
  setWorkspacePaneTabsForTargetQueryData({
    ...target,
    tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
  })
  useWorkspacesStore.getState().setWorkspacePaneTabForTarget(target, 'files')
  const lifecycle = Promise.withResolvers<WorkspacePaneTabEntry[]>()
  installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: vi.fn(async () => await lifecycle.promise) })
  const bridgeFocus = installPendingTerminalFocusBridge()
  const routeCommit = Promise.withResolvers<void>()
  const commitFilesystemWorkspacePaneRoute = vi.fn<
    PrimaryWindowNavigationActions['commitFilesystemWorkspacePaneRoute']
  >(async (_target, _route, options) => {
    await routeCommit.promise
    options?.onCommit?.()
    return true
  })
  const close = dispatchCloseWorkspacePaneTabAction({
    routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
    paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
  })

  expect(terminalOwnsKeyboardInput()).toBe(true)
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
  expect(terminalOwnsKeyboardInput()).toBe(true)

  routeCommit.resolve()
  await expect(close).resolves.toBe(true)
  expect(bridgeFocus).toHaveBeenCalledWith(
    terminalSessionId,
    expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
  )
  expect(terminalOwnsKeyboardInput()).toBe(true)

  const mountedFocus = vi.fn(
    (_terminalSessionId: string, _request: { isCurrent: () => boolean; onSettled: () => void }) => true,
  )
  fulfillTerminalPresentationFocus(terminalSessionId, mountedFocus)
  expect(mountedFocus).toHaveBeenCalledOnce()
  const mountedRequest = mountedFocus.mock.calls[0]![1]
  expect(mountedRequest.isCurrent()).toBe(true)
  mountedRequest.onSettled()
  expect(terminalOwnsKeyboardInput()).toBe(false)
})

test('releases terminal focus and route intent when active close lifecycle fails', async () => {
  const terminalSessionId = 'term-111111111111111111111'
  const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
  useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
  const target = {
    kind: 'workspace-root' as const,
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
  }
  setWorkspacePaneTabsForTargetQueryData({
    ...target,
    tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
  })
  useWorkspacesStore.getState().setWorkspacePaneTabForTarget(target, 'files')
  const lifecycle = Promise.withResolvers<WorkspacePaneTabEntry[]>()
  installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: vi.fn(async () => await lifecycle.promise) })
  installPendingTerminalFocusBridge()
  const commitFilesystemWorkspacePaneRoute = vi.fn<
    PrimaryWindowNavigationActions['commitFilesystemWorkspacePaneRoute']
  >(async () => true)
  const actionTarget = workspacePaneActionTargetFromCoordinates({
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: null,
    worktreePath: '/tmp/workspace-pane-tab-close-repo',
  })

  const close = dispatchCloseWorkspacePaneTabAction({
    routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
    paneTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
  })

  await vi.waitFor(() => expect(workspacePaneRouteIntentPending(actionTarget, 'static:files')).toBe(true))
  expect(terminalOwnsKeyboardInput()).toBe(true)
  expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()

  lifecycle.reject(new Error('simulated close failure'))
  await expect(close).resolves.toBe(false)

  expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  expect(terminalOwnsKeyboardInput()).toBe(false)
  expect(workspacePaneRouteIntentPending(actionTarget, 'static:files')).toBe(false)

  const nextPresentation = beginPrimaryWindowPresentation()
  const nextFocusLease = claimTerminalInputFocus(nextPresentation)
  expect(nextFocusLease).not.toBeNull()
  nextFocusLease?.release()
})

test('reports lifecycle success and clears the transition when close-back navigation rejects', async () => {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
    preferredWorkspacePaneTab: 'files',
    workspacePaneTabsByBranch: {
      [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
    },
  })
  const routeCommit = Promise.withResolvers<boolean>()
  const commitWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
  const close = dispatchCloseWorkspacePaneTabAction({
    routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: BRANCH_NAME },
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation: navigationWith({ commitWorkspacePaneRoute }),
  })

  await vi.waitFor(() => expect(commitWorkspacePaneRoute).toHaveBeenCalledOnce())

  routeCommit.reject(new Error('navigation failed'))
  await expect(close).resolves.toBe(true)
})

test('sends a detached worktree close to the server without requiring a branch', async () => {
  const terminalSessionId = 'term-111111111111111111111'
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
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
  const closeTerminalByDescriptor = vi.fn(async () => {
    throw new Error('server close failed')
  })
  setTerminalSessionCommandBridgeForTest({
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
    selectTerminal: vi.fn(),
    closeTerminalByDescriptor,
  })
  const route = { kind: 'terminal' as const, terminalSessionId }

  await expect(
    dispatchConfirmCloseTerminalWorkspacePaneTabAction({
      routeTarget: WORKTREE_PANE_TARGET,
      paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'detached' },
      workspaceId: REPO_ID,
      workspacePaneRoute: route,
      navigation: navigationWith(),
      currentWorkspacePaneRoute: route,
      confirmedTerminal: {
        terminalSessionId,
        base: {
          target: runtimeTarget,
          presentation: { kind: 'git-worktree' as const, head: { kind: 'detached' as const } },
        },
      },
    }),
  ).resolves.toBe(false)
  expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()
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
  useWorkspacesStore.getState().setWorkspacePaneTabForTarget(targetInput, 'terminal')
  useWorkspacesStore
    .getState()
    .setSelectedTerminal(formatTerminalFilesystemTargetKey(REPO_ID, REPO_ID), terminalSessionId)
  const terminalFilesystemTargetKey = `${REPO_ID}\0${REPO_ID}`
  const closeTerminalByDescriptor = vi.fn(async () => true)
  setTerminalSessionCommandBridgeForTest({
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
    selectTerminal: vi.fn(),
    closeTerminalByDescriptor,
  })
  const targetKey = workspacePaneTabsTargetIdentityKey(targetInput)
  expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe(
    'terminal',
  )
  expect(
    useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[
      formatTerminalFilesystemTargetKey(REPO_ID, REPO_ID)
    ],
  ).toBe(terminalSessionId)
  const navigation = navigationWith({
    commitFilesystemWorkspacePaneRoute: vi.fn(async (_target, route, options) => {
      if (route?.kind === 'static') {
        useWorkspacesStore.getState().setWorkspacePaneTabForTarget(targetInput, route.tab)
      }
      options?.onCommit?.()
      return true
    }),
  })

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
    }),
  ).resolves.toBe(true)

  expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()
  expect(useWorkspacesStore.getState().workspaces[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe(
    'files',
  )
})

test('does not let a late close from an old runtime navigate or clear the replacement runtime opener', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
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
  useWorkspacesStore.setState((state) => ({
    workspaces: {
      ...state.workspaces,
      [REPO_ID]: replacementRepo,
    },
  }))
  seedRepoReadModelQueryData(replacementRepo, {
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
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

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  return observedPrimaryWindowNavigationActionsForTest({
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
  setTerminalSessionCommandBridgeForTest({
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
    selectTerminal: vi.fn(),
    focusTerminal,
  })
  return focusTerminal
}
