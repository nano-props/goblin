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

type RuntimeWorkspacePreferenceActions = Pick<
  WorkspacesStore,
  'setBranchViewMode' | 'setWorkspacePaneTab' | 'setWorkspacePaneTabForTarget'
>
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

    applySessionSelectedTerminalState(selectedTerminalSessionIdByTerminalWorktree: Record<string, string>) {
      // One-shot boot/session restore of per-worktree terminal selection. This
      // seeds client state; later selection changes remain client-owned.
      set((s) => {
        const current = s.selectedTerminalSessionIdByTerminalWorktree
        const currentEntries = Object.entries(current)
        const nextEntries = Object.entries(selectedTerminalSessionIdByTerminalWorktree)
        if (
          currentEntries.length === nextEntries.length &&
          nextEntries.every(
            ([terminalWorktreeKey, terminalSessionId]) => current[terminalWorktreeKey] === terminalSessionId,
          )
        ) {
          return s
        }
        return { selectedTerminalSessionIdByTerminalWorktree: { ...selectedTerminalSessionIdByTerminalWorktree } }
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

    setSelectedTerminal(terminalWorktreeKey: string, terminalSessionId: string | null) {
      set((s) => {
        const current = s.selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]
        if (terminalSessionId) {
          if (current === terminalSessionId) return s
          return {
            selectedTerminalSessionIdByTerminalWorktree: {
              ...s.selectedTerminalSessionIdByTerminalWorktree,
              [terminalWorktreeKey]: terminalSessionId,
            },
          }
        }
        if (current === undefined) return s
        const selectedTerminalSessionIdByTerminalWorktree = { ...s.selectedTerminalSessionIdByTerminalWorktree }
        delete selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]
        return { selectedTerminalSessionIdByTerminalWorktree }
      })
    },
  }
}

function createRuntimeWorkspacePreferenceActions(set: WorkspacesSet, get: WorkspacesGet): RuntimeWorkspacePreferenceActions {
  // Shared post-write effects for view preferences that affect warm restore or
  // visible branch data. Centralized so each preference write stays coherent.
  function afterWorkspacePreferenceChange(id: string, workspaceRuntimeId: string): void {
    const repo = get().workspaces[id]
    if (!repo) return
    persistRepoSnapshotCacheEntry(set, repo, workspaceRuntimeId)
  }

  function setWorkspacePaneTabForTarget(target: WorkspacePaneTabsTarget, tab: WorkspacePaneTabType | null): void {
    let changed = false
    let workspaceRuntimeId: string | undefined
    set((s) => {
      const repo = s.workspaces[target.repoRoot]
      if (!repo || preferredWorkspacePaneTabForTarget(repo.ui, target) === tab) return s
      changed = true
      workspaceRuntimeId = repo.workspaceRuntimeId
      return replaceWorkspaceState(s, repo, (r) => {
        r.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(r.ui, target, tab)
      })
    })
    if (changed && workspaceRuntimeId !== undefined) afterWorkspacePreferenceChange(target.repoRoot, workspaceRuntimeId)
  }

  return {
    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let changed = false
      let workspaceRuntimeId: string | undefined
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || repo.ui.branchViewMode === viewMode) return s
        changed = true
        workspaceRuntimeId = repo.workspaceRuntimeId
        return replaceWorkspaceState(s, repo, (r) => {
          r.ui.branchViewMode = viewMode
        })
      })
      if (changed && workspaceRuntimeId !== undefined) afterWorkspacePreferenceChange(id, workspaceRuntimeId)
    },

    setWorkspacePaneTab(id: string, branch: string, tab: WorkspacePaneTabType | null) {
      // Persists the user's target-scoped preferred pane selection verbatim.
      // Opening/closing branch tabs is owned by explicit open/close actions;
      // this action only changes the target-scoped preferred tab/empty pane.
      const repo = get().workspaces[id]
      if (!repo) return
      const branchModel = requireRepoBranchSnapshotQueryProjection(repo)
      const target = workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: branchModel.branches }, branch)
      if (target) setWorkspacePaneTabForTarget(target, tab)
    },

    setWorkspacePaneTabForTarget,
  }
}

function createWorkspaceNavigationHistoryActions(set: WorkspacesSet, get: WorkspacesGet): WorkspaceNavigationHistoryActions {
  return {
    recordWorkspaceNavigation(entry, options) {
      set((s) => {
        const currentRepoHistory = navigationHistoryForRepo(s.navigationHistoryByWorkspace[entry.workspaceId])
        if (workspaceNavigationHistoryEntryEqual(currentRepoHistory.current, entry)) return s
        const restoredHistory = options?.browserHistoryTraversal
          ? navigationHistoryWithRestoredEntry(currentRepoHistory, entry, options.browserHistoryTraversal)
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
              [entry.workspaceId]: navigationHistoryWithReplacedCurrentEntry(currentRepoHistory, entry),
            },
          }
        }
        if (workspaceNavigationHistoryEntryCanReplaceCurrent(currentRepoHistory.current, entry)) {
          return {
            navigationHistoryByWorkspace: {
              ...s.navigationHistoryByWorkspace,
              [entry.workspaceId]: {
                ...currentRepoHistory,
                current: entry,
              },
            },
          }
        }

        const nextRepoHistory: WorkspaceNavigationHistoryState = {
          current: entry,
          backStack: currentRepoHistory.current
            ? [...currentRepoHistory.backStack, currentRepoHistory.current].slice(
                -MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
              )
            : currentRepoHistory.backStack,
          forwardStack: [],
        }

        return {
          navigationHistoryByWorkspace: {
            ...s.navigationHistoryByWorkspace,
            [entry.workspaceId]: nextRepoHistory,
          },
        }
      })
    },

    peekWorkspaceNavigation(workspaceId, direction) {
      const history = navigationHistoryForRepo(get().navigationHistoryByWorkspace[workspaceId])
      const target = direction === 'back' ? (history.backStack.at(-1) ?? null) : (history.forwardStack[0] ?? null)
      if (!target || !history.current) return null
      return { workspaceId, direction, current: history.current, target }
    },

    commitWorkspaceNavigation(traversal) {
      let committed = false
      set((s) => {
        const currentRepoHistory = navigationHistoryForRepo(s.navigationHistoryByWorkspace[traversal.workspaceId])
        const nextTarget =
          traversal.direction === 'back'
            ? (currentRepoHistory.backStack.at(-1) ?? null)
            : (currentRepoHistory.forwardStack[0] ?? null)
        if (
          !nextTarget ||
          !workspaceNavigationHistoryEntryEqual(currentRepoHistory.current, traversal.current) ||
          !workspaceNavigationHistoryEntryEqual(nextTarget, traversal.target)
        )
          return s
        committed = true
        const nextHistory = commitWorkspaceNavigationTraversal(currentRepoHistory, traversal)
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

function navigationHistoryForRepo(
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
    ...createRuntimeWorkspacePreferenceActions(set, get),
    ...createWorkspaceNavigationHistoryActions(set, get),
  }
}
