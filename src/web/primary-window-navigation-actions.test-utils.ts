import { expect, vi } from 'vitest'
import { createPrimaryWindowNavigationActions as createPrimaryWindowNavigationActionsCore } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalFilesystemTargetSnapshot } from '#/web/components/terminal/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  WorkspaceNavigationHistoryEntry,
  WorkspaceNavigationHistoryTraversal,
} from '#/web/stores/workspaces/types.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { emptyWorkspace, replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

// Vitest has no reusable fixture for primary-window route navigation and workspace history state.
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

export function setupPrimaryWindowNavigationActionsTests() {
  resetWorkspacesStore()
  setTerminalSessionCommandBridge(null)
}

export function preferredWorkspacePaneTab() {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { workspaceId: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
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
      terminalFilesystemTargetKey: null,
      terminalSessionId: null,
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

type PrimaryWindowNavigationActionOptions = Parameters<typeof createPrimaryWindowNavigationActionsCore>[0]
type PrimaryWindowNavigationActionTestOptions = Omit<
  PrimaryWindowNavigationActionOptions,
  'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'
> &
  Partial<Pick<PrimaryWindowNavigationActionOptions, 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>>

export function createPrimaryWindowNavigationActions(options: PrimaryWindowNavigationActionTestOptions) {
  if (options.currentWorkspaceId && !useWorkspacesStore.getState().workspaces[options.currentWorkspaceId]) {
    const workspace = emptyWorkspace(options.currentWorkspaceId, 'navigation-actions-runtime')
    useWorkspacesStore.setState((state) => ({
      workspaces: { ...state.workspaces, [workspace.id]: workspace },
    }))
  }
  const store = useWorkspacesStore.getState()
  return createPrimaryWindowNavigationActionsCore({
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    ...options,
  })
}

export function markRepoGitUnavailable(workspaceId: string): void {
  useWorkspacesStore.setState((state) => {
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

export function routeNavigation(): PrimaryWindowRouteNavigation {
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
    openRepoBranchTerminal: vi.fn((_repoId, _branchName, _sessionId, options) => {
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
