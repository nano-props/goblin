import { replaceWorkspaceState } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/workspaces/persistence.ts'
import {
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspacePaneSize,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type { BranchViewMode, WorkspacesGet, WorkspacesSet, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import type {
  WorkspaceNavigationHistoryEntry,
  WorkspaceNavigationHistoryState,
  WorkspaceNavigationHistoryTraversal,
} from '#/web/stores/workspaces/types.ts'
import {
  workspaceNavigationHistoryEntryCanReplaceCurrent,
  workspaceNavigationHistoryEntryEqual,
} from '#/web/stores/workspaces/navigation-history-entry.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { requireRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'

type RestorableWorkspaceActions = Pick<
  WorkspacesStore,
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'setZenMode'
  | 'toggleZenMode'
  | 'setWorkspacePaneSize'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type WorkspacePanePreferenceActions = Pick<WorkspacesStore, 'setWorkspacePaneTabForTarget'>
type GitWorkspacePreferenceActions = Pick<WorkspacesStore, 'setBranchViewMode' | 'setWorkspacePaneTab'>
type WorkspaceNavigationHistoryActions = Pick<
  WorkspacesStore,
  'recordWorkspaceNavigation' | 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'
>

const MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES = 50

function createRestorableWorkspaceActions(set: WorkspacesSet): RestorableWorkspaceActions {
  return {
    applySessionLayoutState(layoutState: Parameters<WorkspacesStore['applySessionLayoutState']>[0]) {
      // One-shot boot/session restore of restorable layout fields. Runtime
      // edits are persisted later through useClientWorkspacePersistence.
      set((s) => {
        const next = normalizeWorkspaceSessionLayoutState(layoutState)
        if (s.zenMode === next.zenMode && s.workspacePaneSize === next.workspacePaneSize) {
          return s
        }
        return {
          zenMode: next.zenMode,
          workspacePaneSize: next.workspacePaneSize,
        }
      })
    },

    applySessionSelectedTerminalState(selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>) {
      // One-shot boot/session restore of per-filesystem-target terminal selection. This
      // seeds client state; later selection changes remain client-owned.
      set((s) => {
        const current = s.selectedTerminalSessionIdByTerminalFilesystemTarget
        const currentEntries = Object.entries(current)
        const nextEntries = Object.entries(selectedTerminalSessionIdByTerminalFilesystemTarget)
        if (
          currentEntries.length === nextEntries.length &&
          nextEntries.every(
            ([terminalFilesystemTargetKey, terminalSessionId]) =>
              current[terminalFilesystemTargetKey] === terminalSessionId,
          )
        ) {
          return s
        }
        return {
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            ...selectedTerminalSessionIdByTerminalFilesystemTarget,
          },
        }
      })
    },

    setZenMode(enabled: boolean) {
      set((s) => (s.zenMode === enabled ? s : { zenMode: enabled }))
    },

    toggleZenMode() {
      set((s) => ({ zenMode: !s.zenMode }))
    },

    setWorkspacePaneSize(size: number) {
      set((s) => {
        const next = normalizeWorkspacePaneSize(size)
        if (s.workspacePaneSize === next) return s
        return { workspacePaneSize: next }
      })
    },

    resetLayout() {
      set((s) => {
        if (s.workspacePaneSize === DEFAULT_WORKSPACE_PANE_SIZE) {
          return s
        }
        return {
          workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
        }
      })
    },

    setSelectedTerminal(terminalFilesystemTargetKey: string, terminalSessionId: string | null) {
      set((s) => {
        const current = s.selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey]
        if (terminalSessionId) {
          if (current === terminalSessionId) return s
          return {
            selectedTerminalSessionIdByTerminalFilesystemTarget: {
              ...s.selectedTerminalSessionIdByTerminalFilesystemTarget,
              [terminalFilesystemTargetKey]: terminalSessionId,
            },
          }
        }
        if (current === undefined) return s
        const selectedTerminalSessionIdByTerminalFilesystemTarget = {
          ...s.selectedTerminalSessionIdByTerminalFilesystemTarget,
        }
        delete selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey]
        return { selectedTerminalSessionIdByTerminalFilesystemTarget }
      })
    },
  }
}

function setWorkspacePaneTabForTarget(
  set: WorkspacesSet,
  target: WorkspacePaneTabsTarget,
  tab: WorkspacePaneTabType | null,
): void {
  set((state) => {
    const workspace = state.workspaces[target.workspaceId]
    if (!workspace || preferredWorkspacePaneTabForTarget(workspace.ui, target) === tab) return state
    return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
      nextWorkspace.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        nextWorkspace.ui,
        target,
        tab,
      )
    })
  })
}

function createWorkspacePanePreferenceActions(set: WorkspacesSet): WorkspacePanePreferenceActions {
  return {
    setWorkspacePaneTabForTarget: (target, tab) => setWorkspacePaneTabForTarget(set, target, tab),
  }
}

function createGitWorkspacePreferenceActions(set: WorkspacesSet, get: WorkspacesGet): GitWorkspacePreferenceActions {
  return {
    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let changed = false
      let workspaceRuntimeId: string | undefined
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || !isGitWorkspace(repo) || gitWorkspaceProjection(repo).ui.branchViewMode === viewMode) return s
        changed = true
        workspaceRuntimeId = repo.workspaceRuntimeId
        return replaceWorkspaceState(s, repo, (r) => {
          if (!isGitWorkspace(r)) return
          gitWorkspaceProjection(r).ui.branchViewMode = viewMode
        })
      })
      if (changed && workspaceRuntimeId !== undefined) {
        persistRepoSnapshotCacheEntry(set, get().workspaces[id], workspaceRuntimeId)
      }
    },

    setWorkspacePaneTab(id: string, branch: string, tab: WorkspacePaneTabType | null) {
      const repo = get().workspaces[id]
      if (!repo) return
      const branchModel = requireRepoBranchSnapshotQueryProjection(repo)
      const target = workspacePaneTabsTargetForRepoBranch(
        { workspaceId: repo.id, branches: branchModel.branches },
        branch,
      )
      if (target) setWorkspacePaneTabForTarget(set, target, tab)
    },
  }
}

function createWorkspaceNavigationHistoryActions(
  set: WorkspacesSet,
  get: WorkspacesGet,
): WorkspaceNavigationHistoryActions {
  return {
    recordWorkspaceNavigation(entry, options) {
      set((s) => {
        const currentWorkspaceHistory = navigationHistoryForWorkspace(s.navigationHistoryByWorkspace[entry.workspaceId])
        if (workspaceNavigationHistoryEntryEqual(currentWorkspaceHistory.current, entry)) return s
        const restoredHistory = options?.browserHistoryTraversal
          ? navigationHistoryWithRestoredEntry(currentWorkspaceHistory, entry, options.browserHistoryTraversal)
          : null
        if (restoredHistory) {
          return {
            navigationHistoryByWorkspace: {
              ...s.navigationHistoryByWorkspace,
              [entry.workspaceId]: restoredHistory,
            },
          }
        }
        if (options?.replace) {
          return {
            navigationHistoryByWorkspace: {
              ...s.navigationHistoryByWorkspace,
              [entry.workspaceId]: navigationHistoryWithReplacedCurrentEntry(currentWorkspaceHistory, entry),
            },
          }
        }
        if (workspaceNavigationHistoryEntryCanReplaceCurrent(currentWorkspaceHistory.current, entry)) {
          return {
            navigationHistoryByWorkspace: {
              ...s.navigationHistoryByWorkspace,
              [entry.workspaceId]: {
                ...currentWorkspaceHistory,
                current: entry,
              },
            },
          }
        }

        const nextWorkspaceHistory: WorkspaceNavigationHistoryState = {
          current: entry,
          backStack: currentWorkspaceHistory.current
            ? [...currentWorkspaceHistory.backStack, currentWorkspaceHistory.current].slice(
                -MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
              )
            : currentWorkspaceHistory.backStack,
          forwardStack: [],
        }

        return {
          navigationHistoryByWorkspace: {
            ...s.navigationHistoryByWorkspace,
            [entry.workspaceId]: nextWorkspaceHistory,
          },
        }
      })
    },

    peekWorkspaceNavigation(workspaceId, direction) {
      const history = navigationHistoryForWorkspace(get().navigationHistoryByWorkspace[workspaceId])
      const target = direction === 'back' ? (history.backStack.at(-1) ?? null) : (history.forwardStack[0] ?? null)
      if (!target || !history.current) return null
      return { workspaceId, direction, current: history.current, target }
    },

    commitWorkspaceNavigation(traversal) {
      let committed = false
      set((s) => {
        const currentWorkspaceHistory = navigationHistoryForWorkspace(
          s.navigationHistoryByWorkspace[traversal.workspaceId],
        )
        const nextTarget =
          traversal.direction === 'back'
            ? (currentWorkspaceHistory.backStack.at(-1) ?? null)
            : (currentWorkspaceHistory.forwardStack[0] ?? null)
        if (
          !nextTarget ||
          !workspaceNavigationHistoryEntryEqual(currentWorkspaceHistory.current, traversal.current) ||
          !workspaceNavigationHistoryEntryEqual(nextTarget, traversal.target)
        )
          return s
        committed = true
        const nextHistory = commitWorkspaceNavigationTraversal(currentWorkspaceHistory, traversal)
        return {
          navigationHistoryByWorkspace: {
            ...s.navigationHistoryByWorkspace,
            [traversal.workspaceId]: nextHistory,
          },
        }
      })
      return committed
    },
  }
}

function commitWorkspaceNavigationTraversal(
  history: WorkspaceNavigationHistoryState,
  traversal: WorkspaceNavigationHistoryTraversal,
): WorkspaceNavigationHistoryState {
  if (traversal.direction === 'back') {
    return {
      current: traversal.target,
      backStack: history.backStack.slice(0, -1),
      forwardStack: [traversal.current, ...history.forwardStack].slice(0, MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES),
    }
  }
  return {
    current: traversal.target,
    backStack: [...history.backStack, traversal.current].slice(-MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES),
    forwardStack: history.forwardStack.slice(1),
  }
}

function navigationHistoryForWorkspace(
  state: WorkspaceNavigationHistoryState | undefined,
): WorkspaceNavigationHistoryState {
  return state ?? { current: null, backStack: [], forwardStack: [] }
}

function navigationHistoryWithReplacedCurrentEntry(
  history: WorkspaceNavigationHistoryState,
  entry: WorkspaceNavigationHistoryEntry,
): WorkspaceNavigationHistoryState {
  return {
    current: entry,
    backStack: history.backStack.filter((candidate) => !workspaceNavigationHistoryEntryEqual(candidate, entry)),
    forwardStack: history.forwardStack.filter((candidate) => !workspaceNavigationHistoryEntryEqual(candidate, entry)),
  }
}

function navigationHistoryWithRestoredEntry(
  history: WorkspaceNavigationHistoryState,
  entry: WorkspaceNavigationHistoryEntry,
  direction: 'back' | 'forward',
): WorkspaceNavigationHistoryState | null {
  const current = history.current
  if (!current) return null
  const backStackIndex = history.backStack.findLastIndex((candidate) =>
    workspaceNavigationHistoryEntryEqual(candidate, entry),
  )
  const forwardStackIndex = history.forwardStack.findIndex((candidate) =>
    workspaceNavigationHistoryEntryEqual(candidate, entry),
  )
  if (direction === 'back') {
    if (backStackIndex >= 0) return navigationHistoryWithBackStackEntry(history, current, entry, backStackIndex)
    if (forwardStackIndex >= 0)
      return navigationHistoryWithForwardStackEntry(history, current, entry, forwardStackIndex)
    return null
  }
  if (forwardStackIndex >= 0) return navigationHistoryWithForwardStackEntry(history, current, entry, forwardStackIndex)
  if (backStackIndex >= 0) return navigationHistoryWithBackStackEntry(history, current, entry, backStackIndex)
  return null
}

function navigationHistoryWithBackStackEntry(
  history: WorkspaceNavigationHistoryState,
  current: WorkspaceNavigationHistoryEntry,
  entry: WorkspaceNavigationHistoryEntry,
  targetIndex: number,
): WorkspaceNavigationHistoryState {
  return {
    current: entry,
    backStack: history.backStack.slice(0, targetIndex),
    forwardStack: [...history.backStack.slice(targetIndex + 1), current, ...history.forwardStack].slice(
      0,
      MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
    ),
  }
}

function navigationHistoryWithForwardStackEntry(
  history: WorkspaceNavigationHistoryState,
  current: WorkspaceNavigationHistoryEntry,
  entry: WorkspaceNavigationHistoryEntry,
  targetIndex: number,
): WorkspaceNavigationHistoryState {
  return {
    current: entry,
    backStack: [...history.backStack, current, ...history.forwardStack.slice(0, targetIndex)].slice(
      -MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
    ),
    forwardStack: history.forwardStack.slice(targetIndex + 1),
  }
}

export function createSelectionActions(set: WorkspacesSet, get: WorkspacesGet) {
  return {
    ...createRestorableWorkspaceActions(set),
    ...createWorkspacePanePreferenceActions(set),
    ...createGitWorkspacePreferenceActions(set, get),
    ...createWorkspaceNavigationHistoryActions(set, get),
  }
}
