// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-commands.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  runCloseCurrentWorkspacePaneTabCommand as runCloseCurrentWorkspacePaneTabCommandRaw,
  runCloseWorkspacePaneTabCommand as runCloseWorkspacePaneTabCommandRaw,
  runConfirmCloseTerminalWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand as runMoveWorkspacePaneTabCommandRaw,
  runNewTerminalTabCommand as runNewTerminalTabCommandRaw,
  runSelectWorkspacePaneTabByIndexCommand as runSelectWorkspacePaneTabByIndexCommandRaw,
  runShowWorkspacePaneTabCommand as runShowWorkspacePaneTabCommandRaw,
  runTerminalPrimaryActionCommand as runTerminalPrimaryActionCommandRaw,
} from '#/web/commands/workspace-commands.ts'
import { setTerminalSessionCommandBridgeWithCreatedAdmissionForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import {
  createBranchSnapshot,
  installWorkspacePaneTabsTestBridge,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  resetTerminalActionDialogsStore,
  useTerminalActionDialogsStore,
} from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { TerminalFilesystemTargetSnapshot } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneFilesystemRootPath,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  terminalPresentationBranch,
  terminalExecutionPath,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import {
  formatTerminalFilesystemTargetKey,
  formatTerminalFilesystemTargetKeyForPath,
} from '#/shared/terminal-filesystem-target-key.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  observedPrimaryWindowNavigationActionsForTest,
  observedWorkspacePaneRouteForTarget,
  seedInitialObservedWorkspacePaneRouteForTest,
  type ObservedPrimaryWindowNavigationActionsForTest,
  type PrimaryWindowNavigationOverridesForTest,
  type WorkspacePaneNavigationObservation,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { resetPrimaryWindowNavigationForTest } from '#/web/primary-window-navigation-lifecycle.ts'
import { resetTerminalAutoFocusForTest } from '#/web/terminal-focus.ts'
import {
  REPO_ID,
  WORKTREE_KEY,
  WORKTREE_PANE_TARGET,
  WORKTREE_PATH,
  baseForWorktree,
  createTerminalWithProjection,
  emptyWorktreeSnapshot,
  expectedTerminalBase,
  filesystemTargetForTest,
  navigationWith,
  openTabsFor,
  preferredWorkspacePaneTab,
  recordCreatedTerminalSelection,
  removeTerminalFromWorkspacePaneTabsServer,
  runCloseCurrentWorkspacePaneTabCommand,
  runCloseWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
  runShowWorkspacePaneTabCommand,
  runTerminalPrimaryActionCommand,
  staticEntry,
  tabsFor,
  terminalEntry,
  toastMocks,
  worktreeSnapshotForSessions,
  worktreeSnapshotWithSecondTerminalSelected,
  worktreeSnapshotWithTerminal,
  workspaceRuntimeIdForTest,
  workspacePaneTabsTestBridge,
} from '#/web/test-utils/workspace-commands.ts'

describe('workspace commands open', () => {
  test('show workspace pane tab command fast-fails when the target branch projection is missing', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/query',
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'changes',
        navigation,
      }),
    ).resolves.toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('terminal primary action opens the terminal tab and creates the first terminal when missing', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      recordCreatedTerminalSelection(base, terminalSessionId)
      return terminalSessionId
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => ({
        terminalFilesystemTargetKey: WORKTREE_KEY,
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
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchTerminalSession })

    await runTerminalPrimaryActionCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    // "Click the Terminal menu" is a generic entry — no insertion anchor is
    // passed, so the new terminal appends to the end of the strip.
    expect(createTerminal).toHaveBeenCalledWith(expectedTerminalBase(), undefined)
  })

  test('new terminal tab command creates another terminal even when one already exists', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const createTerminal = createTerminalWithProjection(async () => 'term-222222222222222222222')
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchTerminalSession })

    await runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[WORKTREE_KEY]).toBe(
      'term-222222222222222222222',
    )
    // Cmd+T / File → New Terminal Tab is a generic entry — no insertion
    // anchor is passed, so the new terminal appends to the end of the strip.
    expect(createTerminal).toHaveBeenCalledWith(expectedTerminalBase(), undefined)
  })

  test('new terminal tab command preserves a terminal opener across routed close-back', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [terminalEntry('term-111111111111111111111'), staticEntry('status')],
      },
    })
    let visibleSessionIds = ['term-111111111111111111111']
    useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, 'term-111111111111111111111')
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-222222222222222222222'
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      recordCreatedTerminalSelection(base, terminalSessionId)
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      removeTerminalFromWorkspacePaneTabsServer(baseForWorktree(), terminalSessionId)
      return Promise.resolve(true)
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const showRepoBranchEmptyWorkspacePane = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchTerminalSession, showRepoBranchEmptyWorkspacePane })

    expect(
      await runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)

    expect(tabsFor('feature/worktree')).toEqual([
      terminalEntry('term-111111111111111111111'),
      staticEntry('status'),
      terminalEntry('term-222222222222222222222'),
    ])
    expect(
      workspacePaneTabOpener(WORKTREE_PANE_TARGET, workspaceRuntimeIdForTest(), 'terminal:term-222222222222222222222'),
    ).toBe('terminal:term-111111111111111111111')
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    showRepoBranchTerminalSession.mockClear()

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
        targetIdentity: 'terminal:term-222222222222222222222',
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-222222222222222222222', expectedTerminalBase())
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchEmptyWorkspacePane).not.toHaveBeenCalled()
  })

  test('new terminal tab command preserves a static route opener across routed close-back', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          staticEntry('history'),
          terminalEntry('term-111111111111111111111'),
        ],
      },
    })
    let visibleSessionIds = ['term-111111111111111111111']
    useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, 'term-111111111111111111111')
    const closeEvents: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-222222222222222222222'
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      recordCreatedTerminalSelection(base, terminalSessionId)
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      closeEvents.push('close-terminal')
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((_repoId, _branch, tab) => {
      closeEvents.push(`navigate:${tab}`)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const showRepoBranchEmptyWorkspacePane = vi.fn(() => true)
    const navigation = navigationWith({
      showRepoBranchWorkspacePaneTab,
      showRepoBranchTerminalSession,
      showRepoBranchEmptyWorkspacePane,
    })

    expect(
      await runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)

    expect(tabsFor('feature/worktree')).toEqual([
      staticEntry('status'),
      staticEntry('history'),
      terminalEntry('term-111111111111111111111'),
      terminalEntry('term-222222222222222222222'),
    ])
    expect(
      workspacePaneTabOpener(WORKTREE_PANE_TARGET, workspaceRuntimeIdForTest(), 'terminal:term-222222222222222222222'),
    ).toBe('workspace-pane:status')
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    showRepoBranchTerminalSession.mockClear()
    closeEvents.length = 0

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-222222222222222222222', expectedTerminalBase())
    expect(closeEvents).toEqual(['close-terminal', 'navigate:status'])
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(showRepoBranchTerminalSession).not.toHaveBeenCalled()
    expect(showRepoBranchEmptyWorkspacePane).not.toHaveBeenCalled()
  })

  test('new terminal tab command keeps a reused terminal id in its existing tab position', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [terminalEntry('term-111111111111111111111'), staticEntry('status')],
      },
    })
    workspacePaneTabsTestBridge.addRuntimeTab({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      worktreePath: WORKTREE_PATH,
      terminalSessionId: 'term-111111111111111111111',
    })
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
    })

    expect(tabsFor('feature/worktree')).toEqual([terminalEntry('term-111111111111111111111'), staticEntry('status')])
  })

  test('new terminal tab command catches create failures and shows feedback', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => {
      throw new Error('Terminal socket open timed out')
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await expect(
      runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        t: (key) => key,
      }),
    ).resolves.toBe(false)

    expect(toastMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'error.terminal-connection-timeout',
    })
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status')])
  })

  test('new terminal tab command does not show feedback when create is canceled', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => {
      throw new Error('terminal create request canceled')
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await expect(
      runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        t: (key) => key,
      }),
    ).resolves.toBe(false)

    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status')])
  })

  test('new terminal command queues behind an in-flight static close on the same target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes')],
      },
    })
    let resolveCommit!: (tabs: WorkspacePaneTabEntry[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: (input) => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })
    let terminalCreateOperationRan = false
    const createTerminal = vi.fn(async () => {
      terminalCreateOperationRan = true
      return 'term-111111111111111111111'
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchTerminalSession })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await commitStarted

    let terminalSettled = false
    const terminalPromise = runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    }).then((result) => {
      terminalSettled = true
      return result
    })
    await Promise.resolve()
    expect(terminalSettled).toBe(false)
    expect(createTerminal).not.toHaveBeenCalled()
    expect(terminalCreateOperationRan).toBe(false)
    expect(showRepoBranchTerminalSession).not.toHaveBeenCalled()

    resolveCommit([staticEntry('status')])

    await expect(closePromise).resolves.toBe(true)
    await expect(terminalPromise).resolves.toBe(true)
    expect(createTerminal).toHaveBeenCalledOnce()
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
  })

  test('select workspace pane tab by index follows the mixed tab list', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          staticEntry('changes'),
        ],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const focusTerminal = vi.fn(() => false)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal,
      focusTerminal,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    await expect(
      runSelectWorkspacePaneTabByIndexCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tabIndex: 2,
        navigation,
      }),
    ).resolves.toBe(true)
    await expect(
      runSelectWorkspacePaneTabByIndexCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tabIndex: 3,
        navigation,
      }),
    ).resolves.toBe(true)

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(focusTerminal).toHaveBeenCalledOnce()
  })

  test('move workspace pane tab command works for branch-scope tabs without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status'), staticEntry('history')] },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    await expect(
      runMoveWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/no-worktree',
        direction: 1,
        navigation,
      }),
    ).resolves.toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'history')
    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('history')
  })
})
