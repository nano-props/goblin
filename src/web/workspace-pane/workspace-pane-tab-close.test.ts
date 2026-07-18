import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridgeForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import {
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { observeWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  runtimeWorkspacePaneTargetForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

const REPO_ID = 'goblin+file:///tmp/workspace-pane-tab-close-repo'
const BRANCH_NAME = 'feature/worktree-close'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-close-worktree'
const WORKTREE_PANE_TARGET = {
  kind: 'git-worktree' as const,
  repoRoot: REPO_ID,
  worktreePath: WORKTREE_PATH,
}

beforeEach(() => {
  resetWorkspacePaneActionQueueForTest()
  primaryWindowQueryClient.clear()
  resetReposStore()
  setTerminalSessionCommandBridgeForTest(null)
  installWorkspacePaneTabsTestBridge()
})

afterEach(() => {
  setTerminalSessionCommandBridgeForTest(null)
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
      paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
      repoId: REPO_ID,
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

test('closes a workspace-root static tab through the shared tab transaction', async () => {
  const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
  const target = {
    kind: 'workspace-root' as const,
    repoRoot: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,

  }
  setWorkspacePaneTabsForTargetQueryData({
    ...target,
    tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
  })
  useReposStore.getState().setWorkspacePaneTabForTarget(target, 'status')
  const updateWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('files')])
  installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })

  await expect(
    dispatchCloseWorkspacePaneTabAction({
      paneTarget: { kind: 'workspace-root', repoRoot: REPO_ID },
      repoId: REPO_ID,
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
    paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
    repoId: REPO_ID,
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
  const terminalWorktreeKey = `${REPO_ID}\0${WORKTREE_PATH}`
  const runtimeTarget = runtimeWorkspacePaneTargetForTest({
    kind: 'git-worktree' as const,
    repoRoot: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath: WORKTREE_PATH,
  })
  const closeTerminalByDescriptor = vi.fn(async () => {
    throw new Error('server close failed')
  })
  setTerminalSessionCommandBridgeForTest({
    terminalWorktreeSnapshot: () => ({
      terminalWorktreeKey,
      selectedDescriptor: {
        terminalSessionId,
        terminalWorktreeKey,
        index: 1,
        target: runtimeTarget,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'detached' as const } },
      },
      sessions: [
        {
          type: 'terminal',
          terminalSessionId,
          terminalWorktreeKey,
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
    paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'detached' },
      repoId: REPO_ID,
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
    repoRoot: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,

  }
  const runtimeTarget = runtimeWorkspacePaneTargetForTest(targetInput)
  setWorkspacePaneTabsForTargetQueryData({
    ...targetInput,
    tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
  })
  useReposStore.getState().setWorkspacePaneTabForTarget(targetInput, 'terminal')
  useReposStore.getState().setSelectedTerminal(formatTerminalWorktreeKey(REPO_ID, REPO_ID), terminalSessionId)
  const terminalWorktreeKey = `${REPO_ID}\0${REPO_ID}`
  const closeTerminalByDescriptor = vi.fn(async () => true)
  setTerminalSessionCommandBridgeForTest({
    terminalWorktreeSnapshot: () => ({
      terminalWorktreeKey,
      selectedDescriptor: {
        terminalSessionId,
        terminalWorktreeKey,
        index: 1,
        target: runtimeTarget,
        presentation: { kind: 'workspace-root' },
      },
      sessions: [
        {
          type: 'terminal',
          terminalSessionId,
          terminalWorktreeKey,
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
  expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe('terminal')
  expect(
    useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[formatTerminalWorktreeKey(REPO_ID, REPO_ID)],
  ).toBe(terminalSessionId)
  const navigation = navigationWith({
    showWorkspaceRootPaneTab: vi.fn((_repoId, presentation, options) => {
      if (presentation.kind === 'static') {
        useReposStore.getState().setWorkspacePaneTabForTarget(targetInput, presentation.tab)
      }
      options?.onCommit?.()
      return true
    }),
  })

  await expect(
    dispatchConfirmCloseTerminalWorkspacePaneTabAction({
      paneTarget: { kind: 'workspace-root', repoRoot: REPO_ID },
      repoId: REPO_ID,
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
  expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe('files')
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
    repoId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    route: { kind: 'static', tab: 'files' },
  })
  const navigation = navigationWith()
  const close = dispatchCloseWorkspacePaneTabAction({
    paneTarget: WORKTREE_PANE_TARGET,
      worktreeHead: { kind: 'branch', branchName: BRANCH_NAME },
    repoId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation,
  })
  await vi.waitFor(() => expect(updateWorkspaceTabs).toHaveBeenCalledOnce())

  const replacementRuntimeId = 'repo-runtime-replacement'
  const replacementRepo = { ...repo, workspaceRuntimeId: replacementRuntimeId }
  useReposStore.setState((state) => ({
    repos: {
      ...state.repos,
      [REPO_ID]: replacementRepo,
    },
  }))
  seedRepoReadModelQueryData(replacementRepo, {
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranch: BRANCH_NAME,
  })
  setWorkspacePaneTabsForTargetQueryData({
    kind: 'git-worktree' as const,
    repoRoot: REPO_ID,
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
    repoId: REPO_ID,
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
  const navigation: PrimaryWindowNavigationActions = {
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
    commitWorkspacePaneRoute: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
    ...overrides,
    currentWorkspacePaneRoute: overrides.currentWorkspacePaneRoute ?? (() => undefined),
  }
  if (!overrides.commitWorkspacePaneRoute) {
    navigation.commitWorkspacePaneRoute = vi.fn(observedWorkspacePaneRouteCommitForTest(navigation))
  }
  return navigation
}
