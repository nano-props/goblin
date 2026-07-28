import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, vi } from 'vitest'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  runCloseCurrentWorkspacePaneTabCommand as runCloseCurrentWorkspacePaneTabCommandRaw,
  runCloseWorkspacePaneTabCommand as runCloseWorkspacePaneTabCommandRaw,
  runMoveWorkspacePaneTabCommand as runMoveWorkspacePaneTabCommandRaw,
  runNewTerminalTabCommand as runNewTerminalTabCommandRaw,
  runSelectWorkspacePaneTabByIndexCommand as runSelectWorkspacePaneTabByIndexCommandRaw,
  runShowWorkspacePaneTabCommand as runShowWorkspacePaneTabCommandRaw,
  runTerminalPrimaryActionCommand as runTerminalPrimaryActionCommandRaw,
} from '#/web/commands/workspace-commands.ts'
import { setTerminalSessionCommandBridgeWithCreatedAdmissionForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { resetTerminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
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
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import {
  formatTerminalFilesystemTargetKey,
  formatTerminalFilesystemTargetKeyForPath,
} from '#/shared/terminal-filesystem-target-key.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
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

// Command tests need one target, navigation, tab-store, and terminal-projection fixture boundary.
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

export const runCloseWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runCloseWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runCloseWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
export const runCloseCurrentWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runCloseCurrentWorkspacePaneTabCommandRaw>[0], 'target'> &
    WorkspaceCommandFixtureOptions,
) =>
  runCloseCurrentWorkspacePaneTabCommandRaw({
    ...options,
    target: commandTargetForFixture(options),
  })
export const runMoveWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runMoveWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runMoveWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
export const runNewTerminalTabCommand = (
  options: Omit<Parameters<typeof runNewTerminalTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runNewTerminalTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
export const runSelectWorkspacePaneTabByIndexCommand = (
  options: Omit<Parameters<typeof runSelectWorkspacePaneTabByIndexCommandRaw>[0], 'target'> &
    WorkspaceCommandFixtureOptions,
) => runSelectWorkspacePaneTabByIndexCommandRaw({ ...options, target: commandTargetForFixture(options) })
export const runShowWorkspacePaneTabCommand = (
  options: Omit<Parameters<typeof runShowWorkspacePaneTabCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runShowWorkspacePaneTabCommandRaw({ ...options, target: commandTargetForFixture(options) })
export const runTerminalPrimaryActionCommand = (
  options: Omit<Parameters<typeof runTerminalPrimaryActionCommandRaw>[0], 'target'> & WorkspaceCommandFixtureOptions,
) => runTerminalPrimaryActionCommandRaw({ ...options, target: commandTargetForFixture(options) })

const hoistedToastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: hoistedToastMocks.error,
  },
}))

export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-workspace-command-repo')
export const WORKTREE_PATH = '/tmp/goblin-workspace-command-worktree'
export const WORKTREE_PANE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: REPO_ID,
  worktreePath: WORKTREE_PATH,
  head: { kind: 'branch' as const, branchName: 'feature/worktree' },
}
export const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
export let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

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
  hoistedToastMocks.error.mockClear()
})

export const toastMocks = hoistedToastMocks

export function preferredWorkspacePaneTab(branch = 'feature/worktree') {
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

export function openTabsFor(branch: string) {
  return workspacePaneStaticTabsFromEntries(tabsFor(branch))
}

export function tabsFor(branch: string): WorkspacePaneTabEntry[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { workspaceId: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branch,
      )
    : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : []
}

export function workspaceRuntimeIdForTest(workspaceId = REPO_ID): string {
  const repo = useWorkspacesStore.getState().workspaces[workspaceId]
  if (!repo) throw new Error(`expected seeded repo ${workspaceId}`)
  return repo.workspaceRuntimeId
}

export function expectedTerminalBase(): TerminalSessionBase {
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

export function filesystemTargetForTest() {
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

export function createTerminalWithProjection(resolveSessionId: () => string | Promise<string>) {
  return vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = await resolveSessionId()
    recordCreatedTerminalSelection(base, terminalSessionId)
    return terminalSessionId
  })
}

export function recordCreatedTerminalSelection(base: TerminalSessionBase, terminalSessionId: string): void {
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

export function removeTerminalFromWorkspacePaneTabsServer(base: TerminalSessionBase, terminalSessionId: string): void {
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

export function terminalEntry(id: string) {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

export function navigationWith(
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

export function worktreeSnapshotWithTerminal(options: { processName?: string } = {}): TerminalFilesystemTargetSnapshot {
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

export function emptyWorktreeSnapshot(): TerminalFilesystemTargetSnapshot {
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

export function worktreeSnapshotForSessions(terminalSessionIds: string[]): TerminalFilesystemTargetSnapshot {
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

export function worktreeSnapshotWithSecondTerminalSelected(): TerminalFilesystemTargetSnapshot {
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
