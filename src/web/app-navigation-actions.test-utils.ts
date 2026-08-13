import { expect, vi } from 'vitest'
import { createAppNavigationActions as createAppNavigationActionsCore } from '#/web/app-navigation-actions.ts'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalFilesystemTargetSnapshot } from '#/web/components/terminal/types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  WorkspaceNavigationHistoryEntry,
  WorkspaceNavigationHistoryTraversal,
} from '#/web/stores/workspaces/types.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { emptyWorkspace, replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { gitBranchPaneTargetLease, gitWorktreePaneTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'

// Vitest has no reusable fixture for app route navigation and workspace history state.
export const REPO_ID = workspaceIdForTest('goblin+file:///tmp/navigation-actions-repo')
export const REPO_A_ID = workspaceIdForTest('goblin+file:///tmp/repo-a')
export const REPO_B_ID = workspaceIdForTest('goblin+file:///tmp/repo-b')
export const REPO_C_ID = workspaceIdForTest('goblin+file:///tmp/repo-c')
export const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/other-workspace')
export const BRANCH_NAME = 'feature/create-pending'
export const presentationOptions = (options: { replace?: boolean; returnTo?: string | null } = {}) =>
  expect.objectContaining({ ...options, navigationGeneration: expect.any(Number) })
export const historyRestoreOptions = (options: { returnTo?: string | null } = {}) =>
  expect.objectContaining({ ...options, onCommit: expect.any(Function) })
export const WORKTREE_PATH = '/tmp/navigation-actions-worktree'
export const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)

export function branchSelectionLease(branchName = BRANCH_NAME) {
  const workspace = workspacesStore.getState().workspaces[REPO_ID]
  if (!workspace) throw new Error('missing branch selection workspace fixture')
  return gitBranchPaneTargetLease(REPO_ID, workspace.workspaceRuntimeId, branchName)
}

export function worktreeSelectionLease(worktreePath = WORKTREE_PATH) {
  const workspace = workspacesStore.getState().workspaces[REPO_ID]
  if (!workspace) throw new Error('missing worktree selection workspace fixture')
  return gitWorktreePaneTargetLease(REPO_ID, workspace.workspaceRuntimeId, worktreePath)
}

export function setupAppNavigationActionsTests() {
  resetWorkspacesStore()
  setTerminalSessionCommandBridge(null)
}

export function preferredWorkspacePaneTab() {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          {
            workspaceId: repo.id,
            branches: getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.branches ?? [],
            worktrees: getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)?.worktrees ?? [],
          },
          BRANCH_NAME,
        ),
      )
    : null
}

export function branchHistoryEntry(
  workspaceId: WorkspaceId,
  branchName: string,
  workspacePaneTab: 'status' | 'history',
): WorkspaceNavigationHistoryEntry {
  return {
    workspaceId,
    route: {
      kind: 'branch',
      branchName,
      workspacePaneTab,
    },
  }
}

export function historyTraversal(target: WorkspaceNavigationHistoryEntry): WorkspaceNavigationHistoryTraversal {
  return {
    workspaceId: target.workspaceId,
    direction: 'back',
    current: { workspaceId: target.workspaceId, route: { kind: 'dashboard' } },
    target,
  }
}

type AppNavigationActionOptions = Parameters<typeof createAppNavigationActionsCore>[0]
type AppNavigationActionTestOptions = Omit<
  AppNavigationActionOptions,
  'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'
> &
  Partial<Pick<AppNavigationActionOptions, 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>>

export function createAppNavigationActions(options: AppNavigationActionTestOptions) {
  if (options.currentWorkspaceId && !workspacesStore.getState().workspaces[options.currentWorkspaceId]) {
    const workspace = emptyWorkspace(options.currentWorkspaceId, 'navigation-actions-runtime')
    workspacesStore.setState((state) => ({
      workspaces: { ...state.workspaces, [workspace.id]: workspace },
    }))
  }
  const store = workspacesStore.getState()
  return createAppNavigationActionsCore({
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    ...options,
  })
}

export function markRepoGitUnavailable(workspaceId: string): void {
  workspacesStore.setState((state) => {
    const repo = state.workspaces[workspaceId]
    if (!repo) return state
    return {
      workspaces: {
        ...state.workspaces,
        [workspaceId]: replaceWorkspace(repo, (draft) => {
          acceptWorkspaceProbeState(draft, {
            status: 'ready',
            capabilities: {
              files: { read: true, write: true },
              terminal: { available: true },
              git: { status: 'unavailable' },
            },
            diagnostics: [],
          })
        }),
      },
    }
  })
}

export function routeNavigation(): AppRouteNavigation {
  return {
    workspaceSlugForId: vi.fn(() => 'repo-slug'),
    currentWorkspacePaneRoute: () => undefined,
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openWorkspaceNavigator: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    openWorkspaceRootPane: vi.fn((_repoId, options) => {
      options?.onCommit?.()
      return true
    }),
    openWorkspaceRootTab: vi.fn((_workspaceId, _tab, options) => {
      options?.onCommit?.()
      return true
    }),
    openWorkspaceRootTerminal: vi.fn((_workspaceId, _terminalSessionId, options) => {
      options?.onCommit?.()
      return true
    }),
    commitFilesystemWorkspacePaneRoute: vi.fn(async () => {
      throw new Error('Unexpected workspace-root route commit in test')
    }),
    openRepoBranch: vi.fn((_repoId, _branchName, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTab: vi.fn((_repoId, _branchName, _tab, options) => {
      options?.onCommit?.()
      return true
    }),
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
    commitWorkspacePaneRoute: vi.fn(async () => {
      throw new Error('Unexpected workspace pane route commit in test')
    }),
    openRepoNewWorktree: vi.fn((_workspaceId, options) => {
      options?.onCommit?.()
    }),
    cancelRepoNewWorktree: vi.fn(),
  }
}

export function createPendingWorktreeSnapshot(): TerminalFilesystemTargetSnapshot {
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: true,
  }
}

export function worktreeSnapshotForSessions(terminalSessionIds: string[]): TerminalFilesystemTargetSnapshot {
  const workspace = workspacesStore.getState().workspaces[REPO_ID]
  if (!workspace) throw new Error('missing worktree terminal workspace fixture')
  const selectedTerminalSessionId =
    workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[WORKTREE_KEY] ?? null
  const sessions = terminalSessionIds.map((terminalSessionId, index) => ({
    type: 'terminal' as const,
    terminalSessionId,
    terminalFilesystemTargetKey: WORKTREE_KEY,
    index: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: terminalSessionId === selectedTerminalSessionId,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedSession = sessions.find((session) => session.selected) ?? null
  const target = gitWorktreeFilesystemExecutionTarget(REPO_ID, workspace.workspaceRuntimeId, WORKTREE_PATH)
  if (target?.kind !== 'git-worktree') throw new Error('invalid worktree terminal target fixture')
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: selectedSession
      ? {
          terminalSessionId: selectedSession.terminalSessionId,
          index: selectedSession.index,
          target,
          presentation: { kind: 'git-worktree' },
        }
      : null,
    sessions,
    count: sessions.length,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }
}

export function installTerminalSessionCommandBridgeForTest(snapshot: TerminalFilesystemTargetSnapshot) {
  const terminalFilesystemTargetSnapshot = vi.fn((terminalFilesystemTargetKey: string) => {
    if (terminalFilesystemTargetKey !== snapshot.terminalFilesystemTargetKey) {
      throw new Error(`Unexpected terminal filesystem target: ${terminalFilesystemTargetKey}`)
    }
    return snapshot
  })
  setTerminalSessionCommandBridge({
    terminalFilesystemTargetSnapshot,
    createTerminal: vi.fn(async () => {
      throw new Error('Unexpected terminal creation')
    }),
    createTerminalWithAdmission: vi.fn(async () => {
      throw new Error('Unexpected terminal creation admission')
    }),
    selectTerminal: vi.fn(() => {
      throw new Error('Unexpected terminal selection')
    }),
    focusTerminal: vi.fn(() => {
      throw new Error('Unexpected terminal focus')
    }),
    closeTerminalByDescriptor: vi.fn(async () => {
      throw new Error('Unexpected terminal close')
    }),
  })
  return terminalFilesystemTargetSnapshot
}
