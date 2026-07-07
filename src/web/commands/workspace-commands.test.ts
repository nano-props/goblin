// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  runCloseWorkspacePaneTabCommand,
  runCloseWorkspacePaneTabOrWindowCommand,
  runConfirmCloseTerminalWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
  runShowWorkspacePaneTabCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import { closeWorkspacePaneTabsForWorktree } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  resetTerminalActionDialogsStore,
  useTerminalActionDialogsStore,
} from '#/web/stores/repos/terminal-action-dialogs.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
  },
}))

const REPO_ID = '/tmp/gbl-workspace-command-repo'
const WORKTREE_PATH = '/tmp/gbl-workspace-command-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  resetTerminalActionDialogsStore()
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
})

afterEach(() => {
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
  resetTerminalActionDialogsStore()
  toastMocks.error.mockClear()
})

describe('workspace commands', () => {
  test('show workspace pane tab command opens status as a branch static tab when a worktree exists', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', tab: 'status', navigation }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('show workspace pane tab command opens history without routing through status', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', tab: 'history', navigation }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('history')
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
  })

  test('show workspace pane tab command opens changes as a workspace static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', tab: 'changes', navigation }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(openTabsFor('feature/worktree')).toEqual(['changes'])
  })

  test('show workspace pane tab command uses the explicit route branch', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: WORKTREE_PATH } })],
      currentBranch: 'feature/query',
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    await expect(
      runShowWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', tab: 'changes', navigation }),
    ).resolves.toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
  })

  test.each(['status', 'changes'] as const)(
    'show workspace pane tab command refreshes status when opening %s',
    async (tab) => {
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        currentBranchName: 'feature/worktree',
        preferredWorkspacePaneTab: 'history',
        workspacePaneTabsByBranch: { 'feature/worktree': [] },
      })
      setTerminalSessionCommandBridge({
        terminalWorktreeSnapshot: () => ({
          terminalWorktreeKey: WORKTREE_KEY,
          selectedDescriptor: null,
          sessions: [],
          count: 0,
          bellCount: 0,
          outputActiveCount: 0,
          createPending: false,
        }),
        createTerminal: vi.fn(async () => 'session-1'),
        selectTerminal: vi.fn(),
      })
      const refreshRuntimeProjection = vi.fn(async () => {})
      const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId
      useReposStore.setState({
        refreshRuntimeProjection:
          refreshRuntimeProjection as ReturnType<typeof useReposStore.getState>['refreshRuntimeProjection'],
      })

      await expect(
        runShowWorkspacePaneTabCommand({
          repoId: REPO_ID,
          branchName: 'feature/worktree',
          tab,
          navigation: navigationWith(),
        }),
      ).resolves.toBe(true)

      expect(refreshRuntimeProjection).toHaveBeenCalledWith(REPO_ID, { repoInstanceId, sections: ['status'] })
    },
  )

  test('show workspace pane tab command keeps the previous tab when changes has no worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        tab: 'changes',
        navigation,
      }),
    ).resolves.toBe(false)
    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('terminal')
    expect(openTabsFor('feature/no-worktree')).toEqual(['status'])
  })

  test('show workspace pane tab command opens status for a selected branch without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', tab: 'status', navigation }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('terminal primary action opens the terminal tab and creates the first terminal when missing', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'session-1')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
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
    const navigation = navigationWith()

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    // "Click the Terminal menu" is a generic entry — no insertion anchor is
    // passed, so the new terminal appends to the end of the strip.
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('terminal primary action focuses the first existing terminal instead of creating a new one', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'terminal-new')
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [
          {
            type: 'terminal',
            terminalSessionId: 'session-1',
            terminalWorktreeKey: WORKTREE_KEY,
            index: 1,
            title: 'terminal 1',
            phase: 'open',
            selected: true,
            hasBell: false,
            hasRecentOutput: false,
          },
          {
            type: 'terminal',
            terminalSessionId: 'session-2',
            terminalWorktreeKey: WORKTREE_KEY,
            index: 2,
            title: 'terminal 2',
            phase: 'open',
            selected: false,
            hasBell: false,
            hasRecentOutput: false,
          },
        ],
        count: 2,
        bellCount: 0,
        outputActiveCount: 0,
        createPending: false,
      }),
      createTerminal,
      selectTerminal,
    })
    const navigation = navigationWith()

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(createTerminal).not.toHaveBeenCalled()
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('terminal primary action still records the opener when it creates a new terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status'), staticEntry('changes')] },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async () => {
      const terminalSessionId = 'session-1'
      const currentTabs = readWorkspacePaneTabsForTarget({
        repoRoot: REPO_ID,
        repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      })
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: REPO_ID,
        repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        tabs: [...currentTabs, terminalEntry(terminalSessionId)],
      })
      useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    // No terminal exists yet, so this creates one from "status".
    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })
    expect(preferredWorkspacePaneTab()).toBe('terminal')

    // Closing it should reactivate "status" (its opener), not "changes"
    // (the spatial neighbor the generic fallback would otherwise pick).
    expect(await runCloseWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })).toBe(
      true,
    )
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('new terminal tab command creates another terminal even when one already exists', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const createTerminal = createTerminalWithProjection(async () => 'session-2')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await runNewTerminalTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe('session-2')
    // Cmd+T / File → New Terminal Tab is a generic entry — no insertion
    // anchor is passed, so the new terminal appends to the end of the strip.
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('new terminal tab command keeps a reused terminal id in its existing tab position', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [terminalEntry('session-1'), staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => 'session-1')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await runNewTerminalTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation: navigationWith() })

    expect(tabsFor('feature/worktree')).toEqual([terminalEntry('session-1'), staticEntry('status')])
  })

  test('new terminal tab command catches create failures and shows feedback', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await expect(
      runNewTerminalTabCommand({
        repoId: REPO_ID,
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

  test('new terminal tab command does not show feedback when owned create is canceled', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const createOwnedTerminal = vi.fn(async () => {
      throw new Error('terminal create request canceled')
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-ignored'),
      createOwnedTerminal,
      selectTerminal: vi.fn(),
    })

    await expect(
      runNewTerminalTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        t: (key) => key,
      }),
    ).resolves.toBe(false)

    expect(createOwnedTerminal).toHaveBeenCalledTimes(1)
    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status')])
  })

  test('new terminal tab command does not steal focus if user changed view during create', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const { promise, resolve } = Promise.withResolvers<string>()
    const createTerminal = createTerminalWithProjection(() => promise)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    const command = runNewTerminalTabCommand({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
    })
    await vi.waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1))

    // Simulate the user clicking a different tab while the create is in flight.
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')

    resolve('session-2')
    await command

    expect(tabsFor('feature/worktree')).toEqual([
      staticEntry('status'),
      terminalEntry('session-1'),
      terminalEntry('session-2'),
    ])
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe('session-2')
  })

  test('new terminal tab command does not create a terminal after the repo is closed and reopened', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => 'session-reopened-should-not-exist')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    const command = runNewTerminalTabCommand({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
    })
    useReposStore.getState().closeRepo(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/reopened',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/reopened': [staticEntry('status')],
      },
    })

    await expect(command).resolves.toBe(false)
    expect(createTerminal).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command closes the selected terminal when terminal is active', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    // Tab removal is owned by the server workspace tab list broadcast, not the command.
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('session-1')])
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command asks before closing a terminal with a non-shell foreground process', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).not.toHaveBeenCalled()
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toMatchObject({
      repoId: REPO_ID,
      targetIdentity: 'terminal:session-1',
      processName: 'node',
    })
  })

  test('close workspace tab command bypasses the terminal process confirmation after confirm', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:session-1',
        skipTerminalCloseConfirm: true,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toBeNull()
  })

  test('close workspace tab command confirms against the original terminal when selection changes', async () => {
    const otherWorktreePath = '/tmp/gbl-workspace-command-other-worktree'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } }),
        createRepoBranch('feature/other', { worktree: { path: otherWorktreePath } }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
        'feature/other': [staticEntry('status')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:session-1',
      }),
    ).toBe(true)
    const payload = useTerminalActionDialogsStore.getState().closeConfirm
    expect(payload).not.toBeNull()
    if (!payload) throw new Error('expected terminal close confirmation payload')
    expect(payload).toMatchObject({
      repoId: REPO_ID,
      targetIdentity: 'terminal:session-1',
      terminalSessionId: 'session-1',
      terminalBase: {
        repoRoot: REPO_ID,
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      },
    })

    expect(
      await runConfirmCloseTerminalWorkspacePaneTabCommand({
        repoId: payload.repoId,
        branchName: payload.terminalBase.branch,
        navigation: navigationWith(),
        targetIdentity: payload.targetIdentity,
        confirmedTerminal: {
          terminalSessionId: payload.terminalSessionId,
          base: payload.terminalBase,
        },
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('close workspace tab command commits UI without waiting for terminal resources', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    let resolveClose!: (value: boolean) => void
    const closeTerminalByDescriptor = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveClose = resolve
        }),
    )
    const closeWindow = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    let settled = false
    const closePromise = runCloseWorkspacePaneTabOrWindowCommand({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
      closeWindow,
    }).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    await expect(closePromise).resolves.toBe(true)
    expect(settled).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(closeWindow).not.toHaveBeenCalled()

    resolveClose(true)
    await Promise.resolve()
  })

  test('close workspace tab command reads updated terminal projection between rapid closes', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), terminalEntry('session-2')],
      },
    })
    useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, 'session-1')

    let visibleSessionIds = ['session-1', 'session-2']
    const closeResolvers: Array<(value: boolean) => void> = []
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter(
        (candidateTerminalSessionId) => candidateTerminalSessionId !== terminalSessionId,
      )
      useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, visibleSessionIds[0] ?? null)
      return new Promise<boolean>((resolve) => {
        closeResolvers.push(resolve)
      })
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal: vi.fn(async () => 'session-3'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    const firstClose = runCloseWorkspacePaneTabOrWindowCommand({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
      closeWindow,
    })

    const secondClose = runCloseWorkspacePaneTabOrWindowCommand({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
      closeWindow,
    })
    await expect(firstClose).resolves.toBe(true)
    await expect(secondClose).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(1, 'session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(2, 'session-2', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeWindow).not.toHaveBeenCalled()

    closeResolvers.forEach((resolve) => resolve(true))
    await Promise.resolve()
  })

  test('close workspace tab command closes the selected terminal when it is not the first terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), terminalEntry('session-2')],
      },
    })
    useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, 'session-2')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
      createTerminal: vi.fn(async () => 'session-3'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-2', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes the selected status tab without closing the window', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual([])
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'terminal')
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command does not steal focus if the user switches tabs while a static close is in flight', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes'), staticEntry('files')],
      },
    })
    let resolveCommit!: (tabs: WorkspacePaneTabEntry[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    const closePromise = runCloseWorkspacePaneTabCommand({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await commitStarted
    navigation.showRepoBranchWorkspacePaneTab(REPO_ID, 'feature/worktree', 'status')
    showRepoBranchWorkspacePaneTab.mockClear()
    resolveCommit([staticEntry('status'), staticEntry('files')])

    expect(await closePromise).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'files'])
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes changes as a static tab and lands on the adjacent terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal,
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command on the only terminal in a mixed strip lands on the spatial neighbor', async () => {
    // Regression: with preferred=terminal and tabs=[status, session-1, changes],
    // closing session-1 must land on changes (the spatial neighbor), not
    // status (materializedTabs[0]).
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        closeWindow,
        targetIdentity: 'terminal:session-1',
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command reactivates the tab that opened the terminal, chrome-style', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes')],
      },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'session-1'
      const currentTabs = readWorkspacePaneTabsForTarget({
        repoRoot: base.repoRoot,
        repoInstanceId: base.repoInstanceId!,
        branchName: base.branch,
        worktreePath: base.worktreePath,
      })
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: base.repoRoot,
        repoInstanceId: base.repoInstanceId!,
        branchName: base.branch,
        worktreePath: base.worktreePath,
        tabs: [...currentTabs, terminalEntry(terminalSessionId)],
      })
      useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    // Opens a new terminal from the "status" tab — like clicking "+" while
    // status is active. The terminal's opener is now recorded as "status".
    expect(await runNewTerminalTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })).toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('terminal')

    // Closing the terminal should reactivate "status" (its opener), not
    // "changes" (the spatial neighbor the generic fallback would pick).
    expect(
      await runCloseWorkspacePaneTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command ignores the opener when closing a background (non-active) tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes')],
      },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'session-1'
      const currentTabs = readWorkspacePaneTabsForTarget({
        repoRoot: base.repoRoot,
        repoInstanceId: base.repoInstanceId!,
        branchName: base.branch,
        worktreePath: base.worktreePath,
      })
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: base.repoRoot,
        repoInstanceId: base.repoInstanceId!,
        branchName: base.branch,
        worktreePath: base.worktreePath,
        tabs: [...currentTabs, terminalEntry(terminalSessionId)],
      })
      useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    // Opens a new terminal from "status" (its opener becomes "status"), then
    // the user navigates away to "changes" before closing the terminal.
    expect(await runNewTerminalTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })).toBe(true)
    navigation.showRepoBranchWorkspacePaneTab(REPO_ID, 'feature/worktree', 'changes')
    expect(preferredWorkspacePaneTab()).toBe('changes')
    showRepoBranchWorkspacePaneTab.mockClear()

    // Closing the (now background) terminal must not force-navigate back to
    // its opener — the opener only matters when the closing tab was active.
    expect(
      await runCloseWorkspacePaneTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
        targetIdentity: 'terminal:session-1',
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('changes')
  })

  test('close workspace tab command reactivates the tab that opened a static tab, chrome-style', async () => {
    // [status, changes, files] with "status" active. Generic show commands
    // append to the end but still record the opener, so closing history
    // returns focus to "status", not the spatial neighbour.
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes'), staticEntry('files')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    expect(
      await runShowWorkspacePaneTabCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'history',
        navigation,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes', 'files', 'history'])
    expect(preferredWorkspacePaneTab()).toBe('history')

    expect(await runCloseWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', navigation })).toBe(
      true,
    )
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command falls back to closing the window when no workspace tab is selected', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  test('close workspace tab command does not close the window when a targeted tab identity is already gone', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
        targetIdentity: 'terminal:missing-session',
      }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command does not close the window while the terminal host is pending', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command does not close the window while terminal sync is unresolved', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tabs for worktree closes worktree-scoped tabs only', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('session-1'),
          staticEntry('changes'),
          staticEntry('history'),
        ],
      },
    })
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    await expect(
      closeWorkspacePaneTabsForWorktree({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalsForWorktree).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
  })

  test('close workspace tabs for worktree releases pending terminal resources even without a terminal tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    await expect(
      closeWorkspacePaneTabsForWorktree({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalsForWorktree).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('select workspace pane tab by index follows the mixed tab list', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    expect(
      runSelectWorkspacePaneTabByIndexCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        tabIndex: 2,
        navigation,
      }),
    ).toBe(true)
    expect(
      runSelectWorkspacePaneTabByIndexCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        tabIndex: 3,
        navigation,
      }),
    ).toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'terminal')
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('select workspace pane tab by index ignores a pending terminal tab', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    expect(
      runSelectWorkspacePaneTabByIndexCommand({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        tabIndex: 2,
        navigation,
      }),
    ).toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('move workspace pane tab command follows the mixed tab list', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    expect(
      runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', direction: 1, navigation }),
    ).toBe(true)
    expect(
      runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/worktree', direction: 1, navigation }),
    ).toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'terminal')
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('move workspace pane tab command works for branch-scope tabs without a worktree', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status'), staticEntry('history')] },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, branch, tab)
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    expect(
      runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, branchName: 'feature/no-worktree', direction: 1, navigation }),
    ).toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'history')
    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('history')
  })
})

function preferredWorkspacePaneTab(branch = 'feature/worktree') {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          branch,
        ),
      )
    : null
}

function openTabsFor(branch: string) {
  return workspacePaneStaticTabsFromEntries(tabsFor(branch))
}

function tabsFor(branch: string): WorkspacePaneTabEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branch,
      )
    : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, repoInstanceId: repo.instanceId }) : []
}

function createTerminalWithProjection(resolveSessionId: () => string | Promise<string>) {
  return vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = await resolveSessionId()
    const currentTabs = readWorkspacePaneTabsForTarget({
      repoRoot: base.repoRoot,
      repoInstanceId: base.repoInstanceId!,
      branchName: base.branch,
      worktreePath: base.worktreePath,
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: base.repoRoot,
      repoInstanceId: base.repoInstanceId!,
      branchName: base.branch,
      worktreePath: base.worktreePath,
      tabs: [...currentTabs, terminalEntry(terminalSessionId)],
    })
    useReposStore
      .getState()
      .setSelectedTerminal(formatTerminalWorktreeKey(base.repoRoot, base.worktreePath), terminalSessionId)
    return terminalSessionId
  })
}

function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  return {
    activateRepo: (repoId) => useReposStore.setState({ restoredRepoId: repoId }),
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      useReposStore.setState({ restoredRepoId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
    },
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  }
}

function worktreeSnapshotWithTerminal(options: { processName?: string } = {}): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'session-1',
      terminalWorktreeKey: WORKTREE_KEY,
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'session-1',
        terminalWorktreeKey: WORKTREE_KEY,
        index: 1,
        title: 'terminal 1',
        fullTitle: 'terminal 1',
        processName: options.processName ?? 'zsh',
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

function emptyWorktreeSnapshot(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}

function worktreeSnapshotForSessions(terminalSessionIds: string[]): TerminalWorktreeSnapshot {
  const selectedKey = useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY] ?? null
  const sessions = terminalSessionIds.map((terminalSessionId, index) => ({
    type: 'terminal' as const,
    terminalSessionId: terminalSessionId,
    terminalWorktreeKey: WORKTREE_KEY,
    index: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: terminalSessionId === selectedKey,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedSession = sessions.find((session) => session.terminalSessionId === selectedKey) ?? null
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: selectedSession
      ? {
          terminalSessionId: selectedSession.terminalSessionId,
          terminalWorktreeKey: WORKTREE_KEY,
          index: selectedSession.index,
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        }
      : null,
    sessions,
    count: sessions.length,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}

function worktreeSnapshotWithSecondTerminalSelected(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'session-2',
      terminalWorktreeKey: WORKTREE_KEY,
      index: 2,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'session-1',
        terminalWorktreeKey: WORKTREE_KEY,
        index: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: false,
        hasBell: false,
        hasRecentOutput: false,
      },
      {
        type: 'terminal',
        terminalSessionId: 'session-2',
        terminalWorktreeKey: WORKTREE_KEY,
        index: 2,
        title: 'terminal 2',
        phase: 'open',
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ],
    count: 2,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}
