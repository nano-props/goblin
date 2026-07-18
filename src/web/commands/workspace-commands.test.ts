// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  runCloseWorkspacePaneTabCommand as runCloseWorkspacePaneTabCommandRaw,
  runCloseWorkspacePaneTabOrWindowCommand as runCloseWorkspacePaneTabOrWindowCommandRaw,
  runConfirmCloseTerminalWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand as runMoveWorkspacePaneTabCommandRaw,
  runNewTerminalTabCommand as runNewTerminalTabCommandRaw,
  runSelectWorkspacePaneTabByIndexCommand as runSelectWorkspacePaneTabByIndexCommandRaw,
  runShowWorkspacePaneTabCommand as runShowWorkspacePaneTabCommandRaw,
  runTerminalPrimaryActionCommand as runTerminalPrimaryActionCommandRaw,
} from '#/web/commands/workspace-commands.ts'
import { dispatchCreateTerminalWorkspacePaneRuntimeTabAction } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
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
import type { TerminalCreateOptions, TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'

interface WorkspaceCommandFixtureOptions {
  workspaceId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneRouteTarget | null | undefined
  filesystemTarget?: ReturnType<typeof filesystemTargetForTest> | null
}

function commandTargetForFixture(options: WorkspaceCommandFixtureOptions): WorkspacePaneCommandTarget {
  if (options.filesystemTarget) {
    return {
      kind: 'git-worktree',
      workspacePaneRoute: options.workspacePaneRoute,
      filesystemTarget: options.filesystemTarget,
    }
  }
  if (options.branchName) {
    const repo = options.workspaceId ? useWorkspacesStore.getState().workspaces[options.workspaceId] : null
    const branch = repo
      ? readRepoBranchSnapshotQueryProjection(repo)?.branches.find((candidate) => candidate.name === options.branchName)
      : null
    if (repo?.capability.probe.status === 'ready' && branch?.worktree) {
      return {
        kind: 'git-worktree',
        workspacePaneRoute: options.workspacePaneRoute,
        filesystemTarget: {
          kind: 'git-worktree',
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          rootPath: branch.worktree.path,
          head: { kind: 'branch', branchName: options.branchName },
          capabilities: repo.capability.probe.capabilities,
        },
      }
    }
    return { kind: 'git-branch', branchName: options.branchName, workspacePaneRoute: options.workspacePaneRoute }
  }
  const repo = options.workspaceId ? useWorkspacesStore.getState().workspaces[options.workspaceId] : null
  if (!repo || repo.capability.probe.status !== 'ready') throw new Error('expected ready workspace command fixture')
  return {
    kind: 'workspace-root',
    workspacePaneRoute: options.workspacePaneRoute,
    filesystemTarget: {
      kind: 'workspace-root',
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      rootPath: repo.id,
      capabilities: repo.capability.probe.capabilities,
    },
  }
}

const runCloseWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runCloseWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runCloseWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
const runCloseWorkspacePaneTabOrWindowCommand = (
  options: Omit<Parameters<typeof runCloseWorkspacePaneTabOrWindowCommandRaw>[0], 'target'> &
    WorkspaceCommandFixtureOptions,
) =>
  runCloseWorkspacePaneTabOrWindowCommandRaw({
    ...options,
    target: options.workspaceId ? commandTargetForFixture(options) : null,
  })
const runMoveWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runMoveWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runMoveWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
const runNewTerminalTabCommand = (
  options: Omit<Parameters<typeof runNewTerminalTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runNewTerminalTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
const runSelectWorkspacePaneTabByIndexCommand = (
  options: Omit<Parameters<typeof runSelectWorkspacePaneTabByIndexCommandRaw>[0], 'target'> &
    WorkspaceCommandFixtureOptions,
) => runSelectWorkspacePaneTabByIndexCommandRaw({ ...options, target: commandTargetForFixture(options) })
const runShowWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runShowWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runShowWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
const runTerminalPrimaryActionCommand = (
  options: Omit<Parameters<typeof runTerminalPrimaryActionCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runTerminalPrimaryActionCommandRaw({ ...options, target: commandTargetForFixture(options) })
import {
  terminalPresentationBranch,
  terminalExecutionPath,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey, formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { dispatchSelectWorkspacePaneTabByIdentityAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import { dispatchMoveWorkspacePaneTabAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { observeWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import {
  observedWorkspacePaneRouteForTarget,
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type WorkspacePaneNavigationObservation,
} from '#/web/test-utils/workspace-pane-navigation.ts'

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
  },
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-workspace-command-repo')
const OTHER_REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-workspace-command-other-repo')
const WORKTREE_PATH = '/tmp/goblin-workspace-command-worktree'
const WORKTREE_PANE_TARGET = {
  kind: 'git-worktree' as const,
  repoRoot: REPO_ID,
  worktreePath: WORKTREE_PATH,
  head: { kind: 'branch' as const, branchName: 'feature/worktree' },
}
const WORKTREE_KEY = formatTerminalWorktreeKeyForPath(REPO_ID, WORKTREE_PATH)
let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

beforeEach(() => {
  resetWorkspacePaneActionQueueForTest()
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
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
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'status',
        navigation,
      }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('show workspace pane tab command opens history without routing through status', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'history',
        navigation,
      }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('history')
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
  })

  test('show workspace pane tab command opens changes as a workspace static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'changes',
        navigation,
      }),
    ).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(openTabsFor('feature/worktree')).toEqual(['changes'])
  })

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

  test.each(['status', 'changes'] as const)('show workspace pane tab command opens %s', async (tab) => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab,
        navigation: navigationWith(),
      }),
    ).resolves.toBe(true)

    expect(preferredWorkspacePaneTab()).toBe(tab)
    expect(openTabsFor('feature/worktree')).toContain(tab)
  })

  test('show workspace pane tab command keeps the previous tab when changes has no worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status')] },
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
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
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
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status')] },
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
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()
    const commitWorkspacePaneRoute = vi.fn(navigation.commitWorkspacePaneRoute)
    navigation.commitWorkspacePaneRoute = commitWorkspacePaneRoute

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/no-worktree',
        tab: 'status',
        navigation,
      }),
    ).resolves.toBe(true)
    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      REPO_ID,
      'feature/no-worktree',
      { kind: 'static', tab: 'status' },
      expect.objectContaining({ presentationToken: expect.any(Object) }),
    )
    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('status')
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

  test('terminal primary action focuses the first existing terminal instead of creating a new one', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
            terminalSessionId: 'term-111111111111111111111',
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
            terminalSessionId: 'term-222222222222222222222',
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
    expect(createTerminal).not.toHaveBeenCalled()
    expect(selectTerminal).not.toHaveBeenCalled()
  })

  test('terminal primary action still records the opener when it creates a new terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status'), staticEntry('changes')] },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      recordCreatedTerminalSelection(base, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      removeTerminalFromWorkspacePaneTabsServer(baseForWorktree(), terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    // No terminal exists yet, so this creates one from "status".
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
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')

    // Closing it should reactivate "status" (its opener), not "changes"
    // (the spatial neighbor the generic fallback would otherwise pick).
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
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
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
    expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe(
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
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
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
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
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

  test('close workspace tab command returns from files to status when files was opened from the status route', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchEmptyWorkspacePane = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchEmptyWorkspacePane })

    expect(
      await runShowWorkspacePaneTabCommand({
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'files',
        navigation,
      }),
    ).toBe(true)
    expect(workspacePaneTabOpener(WORKTREE_PANE_TARGET, workspaceRuntimeIdForTest(), 'workspace-pane:files')).toBe(
      'workspace-pane:status',
    )
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'files')
    showRepoBranchWorkspacePaneTab.mockClear()

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        targetIdentity: 'workspace-pane:files',
        navigation,
      }),
    ).toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(showRepoBranchEmptyWorkspacePane).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
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
      repoRoot: REPO_ID,
      workspaceRuntimeId: workspaceRuntimeIdForTest(),
      worktreePath: WORKTREE_PATH,
      terminalSessionId: 'term-111111111111111111111',
    })
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
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
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
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
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
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

  test('new terminal tab command opens the created terminal after create finishes', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const { promise, resolve } = Promise.withResolvers<string>()
    const createTerminal = createTerminalWithProjection(() => promise)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    const showRepoBranchTerminalSession = vi.fn(() => true)
    const command = runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchTerminalSession }),
      t: (key) => key,
    })
    await vi.waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1))

    resolve('term-222222222222222222222')
    await command

    expect(tabsFor('feature/worktree')).toEqual([
      staticEntry('status'),
      terminalEntry('term-111111111111111111111'),
      terminalEntry('term-222222222222222222222'),
    ])
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('terminal')
    expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe(
      'term-222222222222222222222',
    )
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
  })

  test('new terminal tab command serializes duplicate create intents on the same target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const firstCreate = Promise.withResolvers<string>()
    const { createTerminal, createTerminalWithAdmission, createOperationCount, isCreatePending } =
      createSingleFlightTerminalWithProjection(async () => await firstCreate.promise)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: isCreatePending() }),
      createTerminal,
      createTerminalWithAdmission,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith({ showRepoBranchTerminalSession })

    const firstCommand = runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await vi.waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1))

    let duplicateSettled = false
    const duplicateCommand = runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    }).then((result) => {
      duplicateSettled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(duplicateSettled).toBe(false)
    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(createOperationCount()).toBe(1)

    firstCreate.resolve('term-222222222222222222222')
    await expect(firstCommand).resolves.toBe(true)
    await expect(duplicateCommand).resolves.toBe(true)
    expect(createTerminal).toHaveBeenCalledTimes(2)
    expect(createOperationCount()).toBe(2)
    expect(showRepoBranchTerminalSession).toHaveBeenCalledTimes(2)
    expect(showRepoBranchTerminalSession).toHaveBeenNthCalledWith(
      1,
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    expect(showRepoBranchTerminalSession).toHaveBeenNthCalledWith(
      2,
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('term-222222222222222222222')])
  })

  test('different terminal create shapes serialize through the same target queue', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const firstCreate = Promise.withResolvers<string>()
    const secondCreate = Promise.withResolvers<string>()
    let firstCreatePending = false
    let secondCreatePending = false
    const createPending = () => firstCreatePending || secondCreatePending
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      secondCreatePending = true
      const terminalSessionId = await secondCreate.promise
      recordCreatedTerminalSelection(base, terminalSessionId)
      secondCreatePending = false
      return terminalSessionId
    })
    const createTerminalWithAdmission = vi.fn(async (base: TerminalSessionBase, _options?: TerminalCreateOptions) => {
      firstCreatePending = true
      const terminalSessionId = await firstCreate.promise
      recordCreatedTerminalSelection(base, terminalSessionId)
      firstCreatePending = false
      return {
        terminalSessionId,
        presentation: base.presentation,
        requestRole: 'leader' as const,
        resourceDisposition: 'created' as const,
        runtimeProjectionApplied: true,
      }
    })
    const showRepoBranchTerminalSession = vi.fn((_repoId: string, _branchName: string, _terminalSessionId: string) => {
      return !createPending()
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: createPending() }),
      createTerminal,
      createTerminalWithAdmission,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith({ showRepoBranchTerminalSession })
    const commitWorkspacePaneRoute = vi.fn(navigation.commitWorkspacePaneRoute)
    navigation.commitWorkspacePaneRoute = commitWorkspacePaneRoute
    const base = {
      target: {
        kind: 'git-worktree' as const,
        workspaceId: canonicalWorkspaceLocator(REPO_ID)!,
        workspaceRuntimeId: workspaceRuntimeIdForTest(),
        root: canonicalWorkspaceLocator('goblin+file:///tmp/goblin-workspace-command-worktree')!,
      },
      presentation: {
        kind: 'git-worktree' as const,
        head: { kind: 'branch' as const, branchName: 'feature/worktree' },
      },
    }

    const firstCommand = runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await vi.waitFor(() => expect(createTerminalWithAdmission).toHaveBeenCalledTimes(1))

    const secondCommand = dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
      base,
      createTerminal: async (createBase) => {
        const terminalSessionId = await createTerminal(createBase)
        return {
          terminalSessionId,
          presentation: createBase.presentation,
          requestRole: 'leader' as const,
          resourceDisposition: 'created' as const,
          runtimeProjectionApplied: true,
        }
      },
      openerIdentity: 'workspace-pane:files',
      showCreatedTerminalTab: (terminalSessionId) =>
        showRepoBranchTerminalSession(REPO_ID, 'feature/worktree', terminalSessionId),
      options: { resolveStartupShellCommand: async () => "bat '/repo/a.ts'\r" },
    })
    await Promise.resolve()
    expect(createTerminal).not.toHaveBeenCalled()

    firstCreate.resolve('term-111111111111111111111')
    await expect(firstCommand).resolves.toBe(true)
    await vi.waitFor(() => expect(createTerminal).toHaveBeenCalledOnce())
    expect(commitWorkspacePaneRoute).toHaveBeenNthCalledWith(
      1,
      REPO_ID,
      'feature/worktree',
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.objectContaining({ presentationToken: expect.any(Object) }),
    )

    secondCreate.resolve('term-222222222222222222222')
    await expect(secondCommand).resolves.toEqual({
      ok: true,
      terminalSessionId: 'term-222222222222222222222',
      presentationStatus: 'committed',
    })
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
  })

  test('new terminal tab command does not navigate when the server rejects a stale workspace runtime', async () => {
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
      await Promise.resolve()
      throw new Error('error.workspace-runtime-stale')
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    const showRepoBranchTerminalSession = vi.fn(() => true)
    const command = runNewTerminalTabCommand({
      filesystemTarget: filesystemTargetForTest(),
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchTerminalSession }),
    })
    await useWorkspacesStore.getState().closeWorkspace(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/reopened',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/reopened': [staticEntry('status')],
      },
    })

    await expect(command).resolves.toBe(false)
    expect(createTerminal).toHaveBeenCalledOnce()
    expect(showRepoBranchTerminalSession).not.toHaveBeenCalled()
    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/reopened')).toBe('status')
  })

  test('close workspace tab command closes the window when no repo target is active', async () => {
    const closeWindow = vi.fn()

    await expect(
      runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: null,
        branchName: null,
        navigation: navigationWith(),
        closeWindow,
      }),
    ).resolves.toBe(true)

    expect(closeWindow).toHaveBeenCalledOnce()
  })

  test('close workspace tab command does nothing when the target projection is unavailable', async () => {
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
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    await expect(
      runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/query',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).resolves.toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes the selected terminal when terminal is active', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
    // Tab removal is owned by the server workspace tab list broadcast, not the command.
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('term-111111111111111111111')])
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command asks before closing a terminal with a non-shell foreground process', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).not.toHaveBeenCalled()
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toMatchObject({
      workspaceId: REPO_ID,
      targetIdentity: 'terminal:term-111111111111111111111',
      workspacePaneRoute,
      processName: 'node',
    })
  })

  test('close workspace tab command bypasses the terminal process confirmation after confirm', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:term-111111111111111111111',
        skipTerminalCloseConfirm: true,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toBeNull()
  })

  test('close workspace tab command confirms against the original terminal when selection changes', async () => {
    const otherWorktreePath = '/tmp/goblin-workspace-command-other-worktree'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } }),
        createBranchSnapshot('feature/other', { worktree: { path: otherWorktreePath } }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
        'feature/other': [staticEntry('status')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:term-111111111111111111111',
      }),
    ).toBe(true)
    const payload = useTerminalActionDialogsStore.getState().closeConfirm
    expect(payload).not.toBeNull()
    if (!payload) throw new Error('expected terminal close confirmation payload')
    expect(payload).toMatchObject({
      workspaceId: REPO_ID,
      targetIdentity: 'terminal:term-111111111111111111111',
      terminalSessionId: 'term-111111111111111111111',
      workspacePaneRoute,
      terminalBase: {
        ...expectedTerminalBase(),
      },
    })

    expect(
      await runConfirmCloseTerminalWorkspacePaneTabCommand({
        workspacePaneRoute: payload.workspacePaneRoute,
        workspaceId: payload.workspaceId,
        currentWorkspacePaneRoute: payload.workspacePaneRoute ?? null,
        navigation: navigationWith(),
        targetIdentity: payload.targetIdentity,
        selectedIdentity: payload.selectedIdentity,
        confirmedTerminal: {
          terminalSessionId: payload.terminalSessionId,
          base: payload.terminalBase,
        },
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
  })

  test('close workspace tab confirm does not navigate when the user has switched away from the original route', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          staticEntry('history'),
        ],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:term-111111111111111111111',
      }),
    ).toBe(true)
    const payload = useTerminalActionDialogsStore.getState().closeConfirm
    if (!payload) throw new Error('expected terminal close confirmation payload')
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })

    expect(
      await runConfirmCloseTerminalWorkspacePaneTabCommand({
        workspacePaneRoute: payload.workspacePaneRoute,
        workspaceId: payload.workspaceId,
        currentWorkspacePaneRoute: { kind: 'static', tab: 'status' },
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        targetIdentity: payload.targetIdentity,
        selectedIdentity: payload.selectedIdentity,
        confirmedTerminal: {
          terminalSessionId: payload.terminalSessionId,
          base: payload.terminalBase,
        },
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('close workspace tab confirm does not navigate after switching to another repo', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          staticEntry('history'),
        ],
      },
    })
    const otherRepo = seedRepoWithReadModelForTest({
      id: OTHER_REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: '/tmp/goblin-workspace-command-other-worktree' },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    useWorkspacesStore.setState({
      workspaces: { [REPO_ID]: repo, [OTHER_REPO_ID]: otherRepo },
      workspaceOrder: [REPO_ID, OTHER_REPO_ID],
      restoredWorkspaceId: OTHER_REPO_ID,
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:term-111111111111111111111',
      }),
    ).toBe(true)
    const payload = useTerminalActionDialogsStore.getState().closeConfirm
    if (!payload) throw new Error('expected terminal close confirmation payload')
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })

    expect(
      await runConfirmCloseTerminalWorkspacePaneTabCommand({
        workspacePaneRoute: payload.workspacePaneRoute,
        workspaceId: payload.workspaceId,
        currentWorkspacePaneRoute: workspacePaneRoute,
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        targetIdentity: payload.targetIdentity,
        selectedIdentity: payload.selectedIdentity,
        confirmedTerminal: {
          terminalSessionId: payload.terminalSessionId,
          base: payload.terminalBase,
        },
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('close workspace tab command waits for terminal close before close-back navigation', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
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
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    let settled = false
    const closePromise = runCloseWorkspacePaneTabOrWindowCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
      closeWindow,
    }).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
    expect(settled).toBe(false)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(closeWindow).not.toHaveBeenCalled()

    resolveClose(true)
    await expect(closePromise).resolves.toBe(true)
    expect(settled).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command reads updated terminal projection between rapid closes', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          terminalEntry('term-222222222222222222222'),
        ],
      },
    })
    useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, 'term-111111111111111111111')

    let visibleSessionIds = ['term-111111111111111111111', 'term-222222222222222222222']
    const closeResolvers: Array<(value: boolean) => void> = []
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter(
        (candidateTerminalSessionId) => candidateTerminalSessionId !== terminalSessionId,
      )
      useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, visibleSessionIds[0] ?? null)
      return new Promise<boolean>((resolve) => {
        closeResolvers.push(resolve)
      })
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    const firstClose = runCloseWorkspacePaneTabOrWindowCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
      closeWindow,
    })

    const secondClose = runCloseWorkspacePaneTabOrWindowCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation: navigationWith(),
      closeWindow,
    })
    await Promise.resolve()

    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(1, 'term-111111111111111111111', expectedTerminalBase())
    expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()
    expect(closeWindow).not.toHaveBeenCalled()

    closeResolvers[0]?.(true)
    await expect(firstClose).resolves.toBe(true)
    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(2, 'term-222222222222222222222', expectedTerminalBase())
    closeResolvers[1]?.(true)
    await expect(secondClose).resolves.toBe(true)
  })

  test('close workspace tab command closes the selected terminal when it is not the first terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          terminalEntry('term-222222222222222222222'),
        ],
      },
    })
    useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, 'term-222222222222222222222')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-222222222222222222222', expectedTerminalBase())
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes the selected status tab without closing the window', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchTerminalSession }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual([])
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes a workspace-root static tab instead of the window', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branchSnapshots: [], currentBranchName: null })
    const target = {
      kind: 'workspace-root' as const,
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      tabs: [staticEntry('status'), staticEntry('files')],
    })
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget(target, 'status')
    const closeWindow = vi.fn()

    await expect(
      runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: null,
        navigation: navigationWith(),
        closeWindow,
      }),
    ).resolves.toBe(true)

    expect(
      readWorkspacePaneTabsForTarget({
        kind: 'workspace-root',
        repoRoot: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      }).map((tab) => tab.type),
    ).toEqual(['files'])
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test.each(['status', 'files'] as const)(
    'reopens a closed workspace-root %s tab through the shared open transaction',
    async (tabType) => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branchSnapshots: [], currentBranchName: null })
    const target = {
      kind: 'workspace-root' as const,
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
    setWorkspacePaneTabsForTargetQueryData({ ...target, tabs: [staticEntry('status'), staticEntry('files')] })
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget(target, tabType)
    const navigation = navigationWith()

    await expect(
      runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: null,
        navigation,
        targetIdentity: `workspace-pane:${tabType}`,
      }),
    ).resolves.toBe(true)
    const remainingType = tabType === 'status' ? 'files' : 'status'
    expect(readWorkspacePaneTabsForTarget(target).map((tab) => tab.type)).toEqual([remainingType])

    await expect(
      runShowWorkspacePaneTabCommand({
        workspacePaneRoute: null,
        workspaceId: REPO_ID,
        branchName: null,
        tab: tabType,
        navigation,
      }),
    ).resolves.toBe(true)
    expect(readWorkspacePaneTabsForTarget(target).map((tab) => tab.type)).toEqual([remainingType, tabType])
    expect(
      preferredWorkspacePaneTabForTarget(useWorkspacesStore.getState().workspaces[REPO_ID]!.ui, {
        kind: 'workspace-root',
        repoRoot: REPO_ID,
      }),
    ).toBe(tabType)
    },
  )

  test('close workspace tab command queues tab switching while a static close is in flight', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      updateWorkspaceTabs: (input) => {
        if (input.operation.type !== 'close-static') {
          return [staticEntry('status'), staticEntry('files')]
        }
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await commitStarted

    let showSettled = false
    const showPromise = runShowWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      tab: 'status',
      navigation,
    }).then((result) => {
      showSettled = true
      return result
    })
    await Promise.resolve()
    expect(showSettled).toBe(false)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()

    resolveCommit([staticEntry('status'), staticEntry('files')])

    expect(await closePromise).toBe(true)
    await expect(showPromise).resolves.toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'files'])
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledOnce()
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
  })

  test('select workspace pane tab command queues behind an in-flight static close on the same target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      updateWorkspaceTabs: (input) => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await commitStarted

    let selectSettled = false
    const selectPromise = runSelectWorkspacePaneTabByIndexCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      tabIndex: 1,
      navigation,
    }).then((result) => {
      selectSettled = true
      return result
    })
    await Promise.resolve()
    expect(selectSettled).toBe(false)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()

    resolveCommit([staticEntry('status'), staticEntry('files')])

    await expect(closePromise).resolves.toBe(true)
    await expect(selectPromise).resolves.toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledOnce()
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
  })

  test('tab strip select action queues behind an in-flight static close on the same target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
      updateWorkspaceTabs: (input) => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await commitStarted

    let selectSettled = false
    const selectPromise = dispatchSelectWorkspacePaneTabByIdentityAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      identity: 'workspace-pane:status',
      navigation,
    }).then((result) => {
      selectSettled = true
      return result
    })
    await Promise.resolve()
    expect(selectSettled).toBe(false)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()

    resolveCommit([staticEntry('status'), staticEntry('files')])

    await expect(closePromise).resolves.toBe(true)
    await expect(selectPromise).resolves.toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledOnce()
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
  })

  test('move workspace pane tab command queues behind an in-flight static close on the same target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await commitStarted

    let moveSettled = false
    const movePromise = runMoveWorkspacePaneTabCommand({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      direction: -1,
      navigation,
    }).then((result) => {
      moveSettled = true
      return result
    })
    await Promise.resolve()
    expect(moveSettled).toBe(false)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()

    resolveCommit([staticEntry('status'), staticEntry('files')])

    await expect(closePromise).resolves.toBe(true)
    await expect(movePromise).resolves.toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'status')
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
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
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

  test('close workspace tab command does not navigate when a static close commit fails', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes'), staticEntry('files')],
      },
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async () => {
        throw new Error('workspace pane tabs update rejected')
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
      }),
    ).toBe(false)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes', 'files'])
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('changes')
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes changes as a static tab and lands on the adjacent terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          staticEntry('changes'),
        ],
      },
    })
    const closeWindow = vi.fn()
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal,
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchTerminalSession }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    expect(selectTerminal).not.toHaveBeenCalled()
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command on the only terminal in a mixed strip lands on the spatial neighbor', async () => {
    // Regression: with preferred=terminal and tabs=[status, term-111111111111111111111, changes],
    // closing term-111111111111111111111 must land on changes (the spatial neighbor), not
    // status (materializedTabs[0]).
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          staticEntry('changes'),
        ],
      },
    })
    const closeWindow = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        closeWindow,
        targetIdentity: 'terminal:term-111111111111111111111',
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'changes')
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command reactivates the tab that opened the terminal, chrome-style', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes')],
      },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      recordCreatedTerminalSelection(base, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    // Opens a new terminal from the "status" tab — like clicking "+" while
    // status is active. The terminal's opener is now recorded as "status".
    expect(
      await runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-111111111111111111111',
    )
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')

    // Closing the terminal should reactivate "status" (its opener), not
    // "changes" (the spatial neighbor the generic fallback would pick).
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command ignores the opener when closing a background (non-active) tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes')],
      },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      recordCreatedTerminalSelection(base, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    // Opens a new terminal from "status" (its opener becomes "status"), then
    // the user navigates away to "changes" before closing the terminal.
    expect(
      await runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    navigation.showRepoBranchWorkspacePaneTab(REPO_ID, 'feature/worktree', 'changes')
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'changes' },
    })
    expect(preferredWorkspacePaneTab()).toBe('changes')
    showRepoBranchWorkspacePaneTab.mockClear()

    // Closing the (now background) terminal must not force-navigate back to
    // its opener — the opener only matters when the closing tab was active.
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
        targetIdentity: 'terminal:term-111111111111111111111',
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
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes'), staticEntry('files')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab })

    expect(
      await runShowWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'history',
        navigation,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes', 'files', 'history'])
    expect(preferredWorkspacePaneTab()).toBe('history')

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command falls back to closing the window when no workspace tab is selected', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  test('close workspace tab command does not close a persisted active tab on a bare branch route', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('history')],
      },
    })
    const closeWindow = vi.fn()
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: null,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        workspacePaneRoute: null,
        navigation: navigationWith({}, { autoSeedInitialRoute: false }),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWindow).toHaveBeenCalledTimes(1)
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command keeps a targeted close on a bare branch route from activating another tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('history')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: null,
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        workspacePaneRoute: null,
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false }),
        targetIdentity: 'workspace-pane:status',
      }),
    ).toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['history'])
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command does not close the window when a targeted tab identity is already gone', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
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
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command closes the selected canonical terminal while its live view is pending', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry(terminalSessionId)],
      },
    })
    useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, terminalSessionId)
    const closeWindow = vi.fn()
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => terminalSessionId),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith(terminalSessionId, expect.any(Object))
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command does not close the window while terminal sync is unresolved', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        closeWindow,
      }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
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
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal,
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
  })

  test('select workspace pane tab by index ignores a pending terminal tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
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
    ).resolves.toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('move workspace pane tab command follows the mixed tab list', async () => {
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
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal,
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    await expect(
      runMoveWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        direction: 1,
        navigation,
      }),
    ).resolves.toBe(true)
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')
    await expect(
      runMoveWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        direction: 1,
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

function preferredWorkspacePaneTab(branch = 'feature/worktree') {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
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
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branch,
      )
    : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : []
}

function workspaceRuntimeIdForTest(workspaceId = REPO_ID): string {
  const repo = useWorkspacesStore.getState().workspaces[workspaceId]
  if (!repo) throw new Error(`expected seeded repo ${workspaceId}`)
  return repo.workspaceRuntimeId
}

function expectedTerminalBase(): TerminalSessionBase {
  const workspaceRuntimeId = workspaceRuntimeIdForTest()
  return {
    target: {
      kind: 'git-worktree' as const,
      workspaceId: canonicalWorkspaceLocator(REPO_ID)!,
      workspaceRuntimeId: workspaceRuntimeId,
      root: canonicalWorkspaceLocator('goblin+file:///tmp/goblin-workspace-command-worktree')!,
    },
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/worktree' } },
  }
}

function filesystemTargetForTest() {
  return {
    kind: 'git-worktree' as const,
    workspaceId: REPO_ID,
    workspaceRuntimeId: workspaceRuntimeIdForTest(),
    rootPath: WORKTREE_PATH,
    head: { kind: 'branch' as const, branchName: 'feature/worktree' },
    capabilities: {
      files: { read: true as const, write: true as const },
      terminal: { available: true as const },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
  }
}

function createTerminalWithProjection(resolveSessionId: () => string | Promise<string>) {
  return vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = await resolveSessionId()
    recordCreatedTerminalSelection(base, terminalSessionId)
    return terminalSessionId
  })
}

function createSingleFlightTerminalWithProjection(resolveSessionId: () => string | Promise<string>) {
  let pending: Promise<string> | null = null
  let createOperationCount = 0
  const createTerminal = vi.fn((base: TerminalSessionBase): Promise<string> => {
    if (pending) return pending
    pending = (async () => {
      createOperationCount += 1
      const terminalSessionId = await resolveSessionId()
      recordCreatedTerminalSelection(base, terminalSessionId)
      return terminalSessionId
    })().finally(() => {
      pending = null
    })
    return pending
  })
  const createTerminalWithAdmission = vi.fn(
    async (base: TerminalSessionBase): Promise<TerminalCreateAdmissionResult> => {
      const requestRole = pending ? ('observer' as const) : ('leader' as const)
      const terminalSessionId = await createTerminal(base)
      const admission = {
        terminalSessionId,
        presentation: base.presentation,
        resourceDisposition: 'created' as const,
        runtimeProjectionApplied: true,
      }
      return requestRole === 'leader'
        ? { ...admission, requestRole: 'leader' }
        : { ...admission, requestRole: 'observer' }
    },
  )
  return {
    createTerminal,
    createTerminalWithAdmission,
    createOperationCount: () => createOperationCount,
    isCreatePending: () => pending !== null,
  }
}

function recordCreatedTerminalSelection(base: TerminalSessionBase, terminalSessionId: string): void {
  const coordinates = terminalSessionCoordinates(base)
  useWorkspacesStore
    .getState()
    .setSelectedTerminal(formatTerminalWorktreeKey(coordinates.repoRoot, coordinates.worktreeId), terminalSessionId)
  const branchName = terminalPresentationBranch(base.presentation)
  if (!branchName) return
  workspacePaneTabsTestBridge.addRuntimeTab({
    repoRoot: coordinates.repoRoot,
    workspaceRuntimeId: coordinates.workspaceRuntimeId,
    branchName,
    worktreePath: terminalExecutionPath(base.target),
    terminalSessionId,
  })
}

function baseForWorktree(): TerminalSessionBase {
  return expectedTerminalBase()
}

function removeTerminalFromWorkspacePaneTabsServer(base: TerminalSessionBase, terminalSessionId: string): void {
  const coordinates = terminalSessionCoordinates(base)
  const branchName = terminalPresentationBranch(base.presentation)
  if (!branchName) throw new Error('expected Git worktree terminal fixture')
  workspacePaneTabsTestBridge.removeRuntimeTab({
    repoRoot: coordinates.repoRoot,
    workspaceRuntimeId: coordinates.workspaceRuntimeId,
    branchName,
    worktreePath: terminalExecutionPath(base.target),
    terminalSessionId,
  })
}

function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

test('rebases the latest queued absolute selection after an earlier route commit', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [staticEntry('status'), staticEntry('files'), staticEntry('history')],
    },
  })
  const target = {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
  observeWorkspacePaneRouteForTest({ ...target, route: { kind: 'static', tab: 'status' } })
  const showRepoBranchWorkspacePaneTab = vi.fn(
    (workspaceId: string, branchName: string, tab: WorkspacePaneStaticTabType) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branchName, tab)
      return true
    },
  )
  const navigation = navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false })

  const selectFiles = dispatchSelectWorkspacePaneTabByIdentityAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    identity: 'workspace-pane:files',
    navigation,
  })
  const selectHistory = dispatchSelectWorkspacePaneTabByIdentityAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    identity: 'workspace-pane:history',
    navigation,
  })
  await expect(selectFiles).resolves.toBe(false)
  await expect(selectHistory).resolves.toBe(true)
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'history')
})

test('resolves each queued relative move from the route current at execution time', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [staticEntry('status'), staticEntry('files'), staticEntry('history')],
    },
  })
  const target = {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
  observeWorkspacePaneRouteForTest({ ...target, route: { kind: 'static', tab: 'status' } })
  const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
  const navigation = navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false })
  const blocker = Promise.withResolvers<void>()
  const blockingAction = runWorkspacePaneAction(workspacePaneActionTargetFromCoordinates(target), () => blocker.promise)

  const firstMove = dispatchMoveWorkspacePaneTabAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })
  const secondMove = dispatchMoveWorkspacePaneTabAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })
  expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()

  blocker.resolve()
  await blockingAction
  await expect(firstMove).resolves.toBe(true)
  await expect(secondMove).resolves.toBe(true)
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'history')
})

test('rejects a queued relative move after its workspace runtime epoch is replaced', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [staticEntry('status'), staticEntry('files')],
    },
  })
  const target = {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
  observeWorkspacePaneRouteForTest({ ...target, route: { kind: 'static', tab: 'status' } })
  const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
  const navigation = navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false })
  const blocker = Promise.withResolvers<void>()
  const blockingAction = runWorkspacePaneAction(workspacePaneActionTargetFromCoordinates(target), () => blocker.promise)
  const move = dispatchMoveWorkspacePaneTabAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })

  useWorkspacesStore.setState((state) => ({
    workspaces: {
      ...state.workspaces,
      [REPO_ID]: { ...state.workspaces[REPO_ID]!, workspaceRuntimeId: 'repo-runtime-replaced' },
    },
  }))
  blocker.resolve()
  await blockingAction

  await expect(move).resolves.toBe(false)
  expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
})

test('rejects a queued absolute selection after its workspace runtime epoch is replaced', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [staticEntry('status'), staticEntry('files')],
    },
  })
  const target = {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
  observeWorkspacePaneRouteForTest({ ...target, route: { kind: 'static', tab: 'status' } })
  const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
  const navigation = navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false })
  const blocker = Promise.withResolvers<void>()
  const blockingAction = runWorkspacePaneAction(workspacePaneActionTargetFromCoordinates(target), () => blocker.promise)
  const select = dispatchSelectWorkspacePaneTabByIdentityAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    identity: 'workspace-pane:files',
    navigation,
  })

  useWorkspacesStore.setState((state) => ({
    workspaces: {
      ...state.workspaces,
      [REPO_ID]: { ...state.workspaces[REPO_ID]!, workspaceRuntimeId: 'repo-runtime-replaced' },
    },
  }))
  blocker.resolve()
  await blockingAction

  await expect(select).resolves.toBe(false)
  expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
})

test('rejects a queued relative move after the router leaves its workspace target', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [staticEntry('status'), staticEntry('files')],
    },
  })
  const target = {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
  let currentRoute: WorkspacePaneRouteTarget | undefined = { kind: 'static', tab: 'status' }
  const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
  const navigation = navigationWith({
    currentWorkspacePaneRoute: () => currentRoute,
    showRepoBranchWorkspacePaneTab,
  })
  const blocker = Promise.withResolvers<void>()
  const blockingAction = runWorkspacePaneAction(workspacePaneActionTargetFromCoordinates(target), () => blocker.promise)
  const move = dispatchMoveWorkspacePaneTabAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })

  currentRoute = undefined
  blocker.resolve()
  await blockingAction

  await expect(move).resolves.toBe(false)
  expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
})

test('serializes open then move through exact route commits', async () => {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': [staticEntry('status'), staticEntry('history')],
    },
  })
  const target = {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
  observeWorkspacePaneRouteForTest({ ...target, route: { kind: 'static', tab: 'status' } })
  const showRepoBranchWorkspacePaneTab = vi.fn(
    (workspaceId: string, branchName: string, tab: WorkspacePaneStaticTabType) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, branchName, tab)
      return true
    },
  )
  const navigation = navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false })

  const openFiles = openWorkspacePaneTab({
    workspaceId: REPO_ID,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
    type: 'files',
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    navigation,
  })
  const move = dispatchMoveWorkspacePaneTabAction({
    paneTarget: WORKTREE_PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })
  await expect(openFiles).resolves.toBe(true)
  await expect(move).resolves.toBe(true)
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
  expect(showRepoBranchWorkspacePaneTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'history')
})

function navigationWith(
  overrides: Partial<PrimaryWindowNavigationActions> = {},
  options: { autoSeedInitialRoute?: boolean } = {},
): PrimaryWindowNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest(undefined, { autoSeed: options.autoSeedInitialRoute !== false })
  const navigation: PrimaryWindowNavigationActions = {
    currentWorkspacePaneRoute: observedWorkspacePaneRouteForTarget,
    activateWorkspace: (workspaceId) =>
      useWorkspacesStore.setState({ restoredWorkspaceId: workspaceIdForTest(workspaceId) }),
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: (workspaceId, branch, tab) => {
      const state = useWorkspacesStore.getState()
      const canonicalWorkspaceId = workspaceIdForTest(workspaceId)
      useWorkspacesStore.setState({ restoredWorkspaceId: canonicalWorkspaceId })
      state.setWorkspacePaneTab(canonicalWorkspaceId, branch, tab)
      return true
    },
    showRepoBranchTerminalSession: () => true,
    showWorkspaceRootPaneTab: (workspaceId, presentation, options) => {
      useWorkspacesStore.getState().setWorkspacePaneTabForTarget(
        { kind: 'workspace-root', repoRoot: workspaceId },
        presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
      )
      options?.onCommit?.()
      return true
    },
    commitWorkspacePaneRoute: () => false,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  }
  if (!overrides.commitWorkspacePaneRoute) {
    navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
  }
  return navigation
}

function worktreeSnapshotWithTerminal(options: { processName?: string } = {}): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'term-111111111111111111111',
      index: 1,
      ...expectedTerminalBase(),
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'term-111111111111111111111',
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
  const selectedKey = useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY] ?? null
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
          index: selectedSession.index,
          ...expectedTerminalBase(),
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
      terminalSessionId: 'term-222222222222222222222',
      index: 2,
      ...expectedTerminalBase(),
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'term-111111111111111111111',
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
        terminalSessionId: 'term-222222222222222222222',
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
