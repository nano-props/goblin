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
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'

const REPO_ID = '/tmp/workspace-pane-tab-close-repo'
const BRANCH_NAME = 'feature/worktree-close'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-close-worktree'

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
  const commitRepoBranchWorkspacePaneRoute = vi.fn(navigation.commitRepoBranchWorkspacePaneRoute)
  navigation.commitRepoBranchWorkspacePaneRoute = commitRepoBranchWorkspacePaneRoute

  await expect(
    dispatchCloseWorkspacePaneTabAction({
      repoId: REPO_ID,
      branchName: BRANCH_NAME,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation,
    }),
  ).resolves.toBe(true)

  expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledWith(
    REPO_ID,
    BRANCH_NAME,
    { kind: 'static', tab: 'status' },
    expect.objectContaining({ presentationToken: expect.any(Object) }),
  )
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'status')
})

test('awaits close-back navigation and clears the transition when navigation rejects', async () => {
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
  const commitRepoBranchWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
  const close = dispatchCloseWorkspacePaneTabAction({
    repoId: REPO_ID,
    branchName: BRANCH_NAME,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation: navigationWith({ commitRepoBranchWorkspacePaneRoute }),
  })

  await vi.waitFor(() => expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledOnce())

  routeCommit.reject(new Error('navigation failed'))
  await expect(close).resolves.toBe(false)
})

test('clears the close transition when the server close command rejects', async () => {
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
  setTerminalSessionCommandBridgeForTest({
    terminalWorktreeSnapshot: () => ({
      terminalWorktreeKey,
      selectedDescriptor: {
        terminalSessionId,
        terminalWorktreeKey,
        index: 1,
        repoRuntimeId: repo.repoRuntimeId,
        repoRoot: REPO_ID,
        branch: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
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
    closeTerminalByDescriptor: vi.fn(async () => {
      throw new Error('server close failed')
    }),
  })
  const route = { kind: 'terminal' as const, terminalSessionId }

  await expect(
    dispatchConfirmCloseTerminalWorkspacePaneTabAction({
      repoId: REPO_ID,
      branchName: BRANCH_NAME,
      workspacePaneRoute: route,
      navigation: navigationWith(),
      currentRepoId: REPO_ID,
      currentBranchName: BRANCH_NAME,
      currentWorkspacePaneRoute: route,
      confirmedTerminal: {
        terminalSessionId,
        base: {
          repoRoot: REPO_ID,
          repoRuntimeId: repo.repoRuntimeId,
          branch: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
        },
      },
    }),
  ).resolves.toBe(false)
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
      REPO_ID,
      repo.repoRuntimeId,
      BRANCH_NAME,
      'workspace-pane:files',
      'workspace-pane:status',
    ),
  ).toBe('recorded')
  observeWorkspacePaneRouteForTest({
    repoId: REPO_ID,
    repoRuntimeId: repo.repoRuntimeId,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    route: { kind: 'static', tab: 'files' },
  })
  const navigation = navigationWith()
  const close = dispatchCloseWorkspacePaneTabAction({
    repoId: REPO_ID,
    branchName: BRANCH_NAME,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation,
  })
  await vi.waitFor(() => expect(updateWorkspaceTabs).toHaveBeenCalledOnce())

  const replacementRuntimeId = 'repo-runtime-replacement'
  const replacementRepo = { ...repo, repoRuntimeId: replacementRuntimeId }
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
    repoRoot: REPO_ID,
    repoRuntimeId: replacementRuntimeId,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    tabs: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
  })
  expect(
    recordWorkspacePaneTabOpener(
      REPO_ID,
      replacementRuntimeId,
      BRANCH_NAME,
      'workspace-pane:files',
      'workspace-pane:status',
    ),
  ).toBe('recorded')
  observeWorkspacePaneRouteForTest({
    repoId: REPO_ID,
    repoRuntimeId: replacementRuntimeId,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    route: { kind: 'static', tab: 'files' },
  })

  serverClose.resolve([workspacePaneStaticTabEntry('status')])
  await expect(close).resolves.toBe(true)
  expect(navigation.commitRepoBranchWorkspacePaneRoute).not.toHaveBeenCalled()
  expect(workspacePaneTabOpener(REPO_ID, replacementRuntimeId, BRANCH_NAME, 'workspace-pane:files')).toBe(
    'workspace-pane:status',
  )
})

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  const navigation: PrimaryWindowNavigationActions = {
    activateRepo: vi.fn(),
    closeRepo: vi.fn(),
    cycleRepo: vi.fn(),
    selectRepoBranch: vi.fn(() => true),
    showRepoBranchEmptyWorkspacePane: vi.fn(() => true),
    showRepoBranchWorkspacePaneTab: vi.fn(() => true),
    showRepoBranchTerminalSession: vi.fn(() => true),
    commitRepoBranchWorkspacePaneRoute: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
    ...overrides,
    currentRepoBranchWorkspacePaneRoute: overrides.currentRepoBranchWorkspacePaneRoute ?? (() => undefined),
  }
  if (!overrides.commitRepoBranchWorkspacePaneRoute) {
    navigation.commitRepoBranchWorkspacePaneRoute = vi.fn(observedWorkspacePaneRouteCommitForTest(navigation))
  }
  return navigation
}
