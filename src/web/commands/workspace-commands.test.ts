// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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

interface WorkspaceCommandFixtureOptions {
  workspaceId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneRouteTarget | null | undefined
  filesystemTarget?: ReturnType<typeof filesystemTargetForTest> | null
}

function commandTargetForFixture(options: WorkspaceCommandFixtureOptions): WorkspacePaneCommandTarget {
  if (options.filesystemTarget) {
    return options.branchName
      ? {
          routeTarget: {
            kind: 'git-branch',
            workspaceId: options.filesystemTarget.workspaceId,
            branchName: options.branchName,
          },
          workspacePaneRoute: options.workspacePaneRoute,
          filesystemTarget: options.filesystemTarget,
        }
      : {
          routeTarget: {
            kind: 'git-worktree',
            workspaceId: options.filesystemTarget.workspaceId,
            worktreePath: workspacePaneFilesystemRootPath(options.filesystemTarget),
          },
          workspacePaneRoute: options.workspacePaneRoute,
          filesystemTarget: options.filesystemTarget,
        }
  }
  if (options.branchName) {
    const repo = options.workspaceId ? useWorkspacesStore.getState().workspaces[options.workspaceId] : null
    const branch = repo
      ? readRepoBranchSnapshotQueryProjection(repo)?.branches.find((candidate) => candidate.name === options.branchName)
      : null
    if (repo?.capability.kind === 'git' && branch?.worktree) {
      return {
        routeTarget: { kind: 'git-branch', workspaceId: repo.id, branchName: options.branchName },
        workspacePaneRoute: options.workspacePaneRoute,
        filesystemTarget: gitWorktreePaneFilesystemTarget({
          workspaceId: repo.id,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          worktreePath: branch.worktree.path,
          head: { kind: 'branch', branchName: options.branchName },
          capabilities: repo.capability.probe.capabilities,
        }),
      }
    }
    if (!options.workspaceId) throw new Error('expected workspace id for branch command fixture')
    return {
      routeTarget: {
        kind: 'git-branch',
        workspaceId: workspaceIdForTest(options.workspaceId),
        branchName: options.branchName,
      },
      workspacePaneRoute: options.workspacePaneRoute,
      filesystemTarget: null,
    }
  }
  const repo = options.workspaceId ? useWorkspacesStore.getState().workspaces[options.workspaceId] : null
  if (!repo || repo.capability.probe.status !== 'ready') throw new Error('expected ready workspace command fixture')
  return {
    routeTarget: { kind: 'workspace-root', workspaceId: repo.id },
    workspacePaneRoute: options.workspacePaneRoute,
    filesystemTarget: workspaceRootPaneFilesystemTarget({
      workspaceId: repo.id,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      capabilities: repo.capability.probe.capabilities,
    }),
  }
}

const runCloseWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runCloseWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runCloseWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
const runCloseCurrentWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runCloseCurrentWorkspacePaneTabCommandRaw>[0], 'target'> &
    WorkspaceCommandFixtureOptions,
) =>
  runCloseCurrentWorkspacePaneTabCommandRaw({
    ...options,
    target: commandTargetForFixture(options),
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

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
  },
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-workspace-command-repo')
const WORKTREE_PATH = '/tmp/goblin-workspace-command-worktree'
const WORKTREE_PANE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: REPO_ID,
  worktreePath: WORKTREE_PATH,
  head: { kind: 'branch' as const, branchName: 'feature/worktree' },
}
const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

beforeEach(() => {
  resetTerminalAutoFocusForTest()
  resetWorkspacePaneActionQueueForTest()
  resetPrimaryWindowNavigationForTest()
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  resetTerminalActionDialogsStore()
  useTerminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
})

afterEach(() => {
  resetTerminalAutoFocusForTest()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
  resetTerminalActionDialogsStore()
  toastMocks.error.mockClear()
})

describe('workspace commands', () => {
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
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    await expect(
      runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/query',
        navigation: navigationWith(),
      }),
    ).resolves.toBe(false)
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
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toMatchObject({
      workspaceId: REPO_ID,
      targetIdentity: 'terminal:term-111111111111111111111',
      workspacePaneRoute,
      processName: 'node',
    })
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
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
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
        routeTarget: payload.routeTarget,
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

  test('close workspace tab command uses each committed snapshot between rapid closes', async () => {
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
      return new Promise<boolean>((resolve) => {
        closeResolvers.push((value) => {
          if (value) {
            visibleSessionIds = visibleSessionIds.filter(
              (candidateTerminalSessionId) => candidateTerminalSessionId !== terminalSessionId,
            )
            setWorkspacePaneTabsForTargetQueryData({
              workspaceId: REPO_ID,
              workspaceRuntimeId: workspaceRuntimeIdForTest(),
              branchName: 'feature/worktree',
              worktreePath: WORKTREE_PATH,
              tabs: [staticEntry('status'), ...visibleSessionIds.map(terminalEntry)],
            })
            useWorkspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, visibleSessionIds[0] ?? null)
          }
          resolve(value)
        })
      })
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchTerminalSession, showRepoBranchWorkspacePaneTab })

    const firstClose = runCloseCurrentWorkspacePaneTabCommand({
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })

    const secondClose = runCloseCurrentWorkspacePaneTabCommand({
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await Promise.resolve()

    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(1, 'term-111111111111111111111', expectedTerminalBase())
    expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()

    closeResolvers[0]?.(true)
    await expect(firstClose).resolves.toBe(true)
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(2, 'term-222222222222222222222', expectedTerminalBase())
    closeResolvers[1]?.(true)
    await expect(secondClose).resolves.toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
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
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-222222222222222222222', expectedTerminalBase())
  })

  test.each(['status', 'files'] as const)(
    'reopens a closed workspace-root %s tab through the shared open transaction',
    async (tabType) => {
      const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branchSnapshots: [], currentBranchName: null })
      const target = {
        kind: 'workspace-root' as const,
        workspaceId: REPO_ID,
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
          workspaceId: REPO_ID,
        }),
      ).toBe(tabType)
    },
  )

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
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
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
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: null,
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        workspacePaneRoute: null,
        navigation: navigationWith({}, { autoSeedInitialRoute: false }),
      }),
    ).toBe(false)

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

  test('close workspace tab command does nothing when a targeted tab identity is already gone', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:missing-session',
      }),
    ).toBe(false)

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command does nothing while the terminal host is pending', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
      }),
    ).toBe(true)

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
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => terminalSessionId),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith(terminalSessionId, expect.any(Object))
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

function preferredWorkspacePaneTab(branch = 'feature/worktree') {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { workspaceId: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
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
        { workspaceId: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
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
  return gitWorktreePaneFilesystemTarget({
    workspaceId: REPO_ID,
    workspaceRuntimeId: workspaceRuntimeIdForTest(),
    worktreePath: WORKTREE_PATH,
    head: { kind: 'branch', branchName: 'feature/worktree' },
    capabilities: {
      files: { read: true as const, write: true as const },
      terminal: { available: true as const },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
  })
}

function createTerminalWithProjection(resolveSessionId: () => string | Promise<string>) {
  return vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = await resolveSessionId()
    recordCreatedTerminalSelection(base, terminalSessionId)
    return terminalSessionId
  })
}

function recordCreatedTerminalSelection(base: TerminalSessionBase, terminalSessionId: string): void {
  const coordinates = terminalSessionCoordinates(base)
  useWorkspacesStore
    .getState()
    .setSelectedTerminal(
      formatTerminalFilesystemTargetKey(coordinates.workspaceId, coordinates.executionRootId),
      terminalSessionId,
    )
  const branchName = terminalPresentationBranch(base.presentation)
  if (!branchName) return
  workspacePaneTabsTestBridge.addRuntimeTab({
    workspaceId: coordinates.workspaceId,
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
    workspaceId: coordinates.workspaceId,
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

function navigationWith(
  overrides: PrimaryWindowNavigationOverridesForTest = {},
  options: { autoSeedInitialRoute?: boolean } = {},
): ObservedPrimaryWindowNavigationActionsForTest {
  seedInitialObservedWorkspacePaneRouteForTest(undefined, { autoSeed: options.autoSeedInitialRoute !== false })
  return observedPrimaryWindowNavigationActionsForTest({
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
      useWorkspacesStore
        .getState()
        .setWorkspacePaneTabForTarget(
          { kind: 'workspace-root', workspaceId: workspaceId },
          presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
        )
      options?.onCommit?.()
      return true
    },
    commitFilesystemWorkspacePaneRoute: async (target, route, options) => {
      if (target.routeTarget.kind !== 'workspace-root') {
        throw new Error('unexpected detached-worktree route commit in workspace command fixture')
      }
      useWorkspacesStore
        .getState()
        .setWorkspacePaneTabForTarget(
          target.routeTarget,
          route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null,
        )
      options?.onCommit?.()
      return true
    },
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  })
}

function worktreeSnapshotWithTerminal(options: { processName?: string } = {}): TerminalFilesystemTargetSnapshot {
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'term-111111111111111111111',
      index: 1,
      ...expectedTerminalBase(),
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'term-111111111111111111111',
        terminalFilesystemTargetKey: WORKTREE_KEY,
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

function emptyWorktreeSnapshot(): TerminalFilesystemTargetSnapshot {
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}

function worktreeSnapshotForSessions(terminalSessionIds: string[]): TerminalFilesystemTargetSnapshot {
  const selectedKey =
    useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[WORKTREE_KEY] ?? null
  const sessions = terminalSessionIds.map((terminalSessionId, index) => ({
    type: 'terminal' as const,
    terminalSessionId: terminalSessionId,
    terminalFilesystemTargetKey: WORKTREE_KEY,
    index: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: terminalSessionId === selectedKey,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedSession = sessions.find((session) => session.terminalSessionId === selectedKey) ?? null
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
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

function worktreeSnapshotWithSecondTerminalSelected(): TerminalFilesystemTargetSnapshot {
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'term-222222222222222222222',
      index: 2,
      ...expectedTerminalBase(),
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'term-111111111111111111111',
        terminalFilesystemTargetKey: WORKTREE_KEY,
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
        terminalFilesystemTargetKey: WORKTREE_KEY,
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
