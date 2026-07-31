import {
  workspaceNavigationHistoryEntryCanReplaceCurrent,
  workspaceNavigationHistoryEntryEqual,
} from '#/web/stores/workspaces/navigation-history-entry.ts'
import type {
  WorkspaceNavigationHistoryEntry,
  WorkspaceNavigationHistoryActions,
  WorkspaceNavigationHistoryCollectionState,
  WorkspaceNavigationHistoryState,
  WorkspaceNavigationHistoryTraversal,
  WorkspacesGet,
  WorkspacesSet,
} from '#/web/stores/workspaces/types.ts'

const MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES = 50

export function createWorkspaceNavigationHistoryActions(
  set: WorkspacesSet,
  get: WorkspacesGet,
): WorkspaceNavigationHistoryActions {
  return {
    recordWorkspaceNavigation(entry, options) {
      set((state) => {
        const currentWorkspaceHistory = navigationHistoryForWorkspace(
          state.navigationHistoryByWorkspace[entry.workspaceId],
        )
        if (workspaceNavigationHistoryEntryEqual(currentWorkspaceHistory.current, entry)) return state
        const restoredHistory = options?.browserHistoryTraversal
          ? navigationHistoryWithRestoredEntry(currentWorkspaceHistory, entry, options.browserHistoryTraversal)
          : null
        if (restoredHistory) {
          return workspaceStateWithNavigationHistory(state, entry.workspaceId, restoredHistory)
        }
        if (options?.replace) {
          return workspaceStateWithNavigationHistory(
            state,
            entry.workspaceId,
            navigationHistoryWithReplacedCurrentEntry(currentWorkspaceHistory, entry),
          )
        }
        if (workspaceNavigationHistoryEntryCanReplaceCurrent(currentWorkspaceHistory.current, entry)) {
          return workspaceStateWithNavigationHistory(state, entry.workspaceId, {
            ...currentWorkspaceHistory,
            current: entry,
          })
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

        return workspaceStateWithNavigationHistory(state, entry.workspaceId, nextWorkspaceHistory)
      })
    },

    peekWorkspaceNavigation(workspaceId, direction) {
      const history = navigationHistoryForWorkspace(get().navigationHistoryByWorkspace[workspaceId])
      const target = navigationHistoryTraversalTarget(history, direction)
      if (!target || !history.current) return null
      return { workspaceId, direction, current: history.current, target }
    },

    commitWorkspaceNavigation(traversal) {
      let committed = false
      set((state) => {
        const currentWorkspaceHistory = navigationHistoryForWorkspace(
          state.navigationHistoryByWorkspace[traversal.workspaceId],
        )
        const nextTarget = navigationHistoryTraversalTarget(currentWorkspaceHistory, traversal.direction)
        if (
          !nextTarget ||
          !workspaceNavigationHistoryEntryEqual(currentWorkspaceHistory.current, traversal.current) ||
          !workspaceNavigationHistoryEntryEqual(nextTarget, traversal.target)
        ) {
          return state
        }
        committed = true
        return workspaceStateWithNavigationHistory(
          state,
          traversal.workspaceId,
          commitWorkspaceNavigationTraversal(currentWorkspaceHistory, traversal),
        )
      })
      return committed
    },
  }
}

function workspaceStateWithNavigationHistory(
  state: WorkspaceNavigationHistoryCollectionState,
  workspaceId: string,
  history: WorkspaceNavigationHistoryState,
): WorkspaceNavigationHistoryCollectionState {
  return {
    navigationHistoryByWorkspace: {
      ...state.navigationHistoryByWorkspace,
      [workspaceId]: history,
    },
  }
}

function navigationHistoryTraversalTarget(
  history: WorkspaceNavigationHistoryState,
  direction: WorkspaceNavigationHistoryTraversal['direction'],
): WorkspaceNavigationHistoryEntry | null {
  return direction === 'back' ? (history.backStack.at(-1) ?? null) : (history.forwardStack[0] ?? null)
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
  direction: WorkspaceNavigationHistoryTraversal['direction'],
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
