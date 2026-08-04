import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { cleanup, render as renderTestingLibrary } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { WorkspacePaneTabStripScrollMemoryProvider } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'
import type { AppNavigationActions } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { createAppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { resetAppNavigationForTest } from '#/web/app-navigation-lifecycle.ts'

export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-workspace-container-repo')

export function render(element: ReactElement) {
  return renderTestingLibrary(element, { wrapper: WorkspacePaneTabStripScrollMemoryProvider })
}

beforeEach(() => {
  useHostInfoStore.setState({
    snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
    status: 'ready',
    error: null,
  })
})

export const presentationOptions = (options: { replace?: boolean } = {}) =>
  expect.objectContaining({ ...options, navigationGeneration: expect.any(Number) })

export const historyRestoreOptions = () => expect.objectContaining({ onCommit: expect.any(Function) })

export const terminalReadContext: TerminalSessionReadContextValue = {
  terminalFilesystemTargetSnapshot: () => EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  subscribeTerminalFilesystemTarget: () => () => {},
  workspaceBellCount: () => 0,
  subscribeWorkspaceBellCount: () => () => {},
  snapshot: () => EMPTY_TERMINAL_SNAPSHOT,
  subscribeSnapshot: () => () => {},
}

export const terminalCommandContext: TerminalSessionContextValue = terminalSessionContextForTest({
  createTerminal: vi.fn(async () => 'term-111111111111111111111'),
  selectTerminal: vi.fn(),
  scrollToBottom: vi.fn(),
  clearBell: vi.fn(() => false),
  closeTerminalByDescriptor: vi.fn(async () => true),
  attach: vi.fn(),
  detach: vi.fn(),
  restart: vi.fn(),
  findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
  findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
  clearSearch: vi.fn(),
  takeover: vi.fn(async () => true),
  focusTerminal: vi.fn(),
})

export const navigation: AppNavigationActions = {
  ...appNavigationActionsForTest(),
  currentWorkspacePaneRoute: () => undefined,
  activateWorkspace: vi.fn(),
  closeWorkspace: vi.fn(),
  cycleWorkspace: vi.fn(),
  selectRepoBranch: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  openSettings: vi.fn(),
  openCreateWorktree: vi.fn(),
}

export let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

beforeEach(() => {
  resetAppNavigationForTest()
  resetWorkspacePaneActionQueueForTest()
  appQueryClient.clear()
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

export function directoryWorkspaceProbe(options: { filesWritable?: boolean; terminalAvailable?: boolean } = {}) {
  return {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: options.filesWritable ?? true },
      terminal: { available: options.terminalAvailable ?? true },
      git: { status: 'unavailable' as const },
    },
    diagnostics: [],
  }
}

export function gitWorktreeFilesystemTarget(repo: WorkspaceState, rootPath: string, branchName: string) {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  return gitWorktreePaneFilesystemTarget({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath: rootPath,
    head: { kind: 'branch', branchName },
    capabilities: repo.capability.probe.capabilities,
  })
}

export function scrollViewport(container: HTMLElement): HTMLDivElement {
  const viewport = container.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
  if (!viewport) throw new Error('missing workspace tab strip scroll viewport')
  return viewport
}

export function terminalReadContextWithSession(
  terminalFilesystemTargetKey: string,
  terminalSessionId: string,
): TerminalSessionReadContextValue {
  return terminalReadContextWithSessions(terminalFilesystemTargetKey, [terminalSessionId], terminalSessionId)
}

export function terminalReadContextWithSessions(
  terminalFilesystemTargetKey: string,
  terminalSessionIds: readonly string[],
  selectedTerminalSessionId: string | null = terminalSessionIds[0] ?? null,
  options: { createPending?: boolean; sessionTitles?: Readonly<Record<string, string>> } = {},
): TerminalSessionReadContextValue {
  const snapshot: TerminalFilesystemTargetSnapshot = {
    terminalFilesystemTargetKey,
    selectedDescriptor: null,
    sessions: terminalSessionIds.map((terminalSessionId, index) => ({
      type: 'terminal',
      terminalSessionId,
      terminalFilesystemTargetKey,
      index: index + 1,
      title: options.sessionTitles?.[terminalSessionId] ?? terminalSessionId,
      phase: 'open',
      selected: terminalSessionId === selectedTerminalSessionId,
      hasBell: false,
      hasRecentOutput: false,
    })),
    count: terminalSessionIds.length,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: options.createPending ?? false,
  }
  return {
    ...terminalReadContext,
    terminalFilesystemTargetSnapshot: (key) =>
      key === terminalFilesystemTargetKey ? snapshot : EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  }
}

export function navigationWithStore(
  routeNavigationOverrides: AppRouteNavigation = routeNavigation(),
): AppNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  const store = useWorkspacesStore.getState()
  const navigation = createAppNavigationActions({
    currentWorkspaceId: REPO_ID,
    workspaceOrder: [REPO_ID],
    closeWorkspace: store.closeWorkspace,
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    routeNavigation: routeNavigationOverrides,
  })
  const commitRoute = navigation.commitWorkspacePaneRoute
  navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest({}, { commitRoute })
  return navigation
}

export function routeNavigation(): AppRouteNavigation {
  const openRepoBranch: AppRouteNavigation['openRepoBranch'] = vi.fn((_repoId, _branchName, options) => {
    options?.onCommit?.()
    return true
  })
  const openRepoBranchTab: AppRouteNavigation['openRepoBranchTab'] = vi.fn((_repoId, _branchName, _tab, options) => {
    options?.onCommit?.()
    return true
  })
  const openRepoBranchTerminal: AppRouteNavigation['openRepoBranchTerminal'] = vi.fn(
    (_repoId, _branchName, _sessionId, options) => {
      options?.onCommit?.()
      return true
    },
  )
  return {
    workspaceSlugForId: vi.fn(() => 'repo-workspace-container-repo'),
    currentWorkspacePaneRoute: () => undefined,
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openWorkspaceNavigator: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    openWorkspaceRootPane: vi.fn(),
    openWorkspaceRootTab: vi.fn(),
    openWorkspaceRootTerminal: vi.fn(),
    commitFilesystemWorkspacePaneRoute: vi.fn(async () => {
      throw new Error('Unexpected workspace-root route commit in test')
    }),
    openRepoBranch,
    openRepoBranchTab,
    openRepoBranchTerminal,
    openRepoWorktree: vi.fn((_repoId, _worktreePath, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoWorktreeTerminal: vi.fn(() => {
      throw new Error('Unexpected worktree terminal navigation in test')
    }),
    openRepoWorktreeTab: vi.fn(() => {
      throw new Error('Unexpected worktree tab navigation in test')
    }),
    commitWorkspacePaneRoute: vi.fn(async (workspaceId, branchName, route, options) => {
      if (route === null) return openRepoBranch(workspaceId, branchName, options)
      return route.kind === 'static'
        ? openRepoBranchTab(workspaceId, branchName, route.tab, options)
        : openRepoBranchTerminal(workspaceId, branchName, route.terminalSessionId, options)
    }),
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}
