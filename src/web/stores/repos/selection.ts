import { replaceRepoState } from '#/web/stores/repos/repo-state-factory.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspacePaneSize,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type { BranchViewMode, RepoState, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import type { WorkspaceNavigationHistoryRepoState } from '#/web/stores/repos/types.ts'
import { workspaceNavigationHistoryEntryEqual } from '#/web/stores/repos/navigation-history-entry.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { requireRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

type RestorableWorkspaceActions = Pick<
  ReposStore,
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'setZenMode'
  | 'toggleZenMode'
  | 'setWorkspacePaneSize'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type RuntimeWorkspacePreferenceActions = Pick<ReposStore, 'setBranchViewMode' | 'setWorkspacePaneTab'>
type WorkspaceNavigationHistoryActions = Pick<
  ReposStore,
  'recordWorkspaceNavigation' | 'goBackInWorkspaceNavigation' | 'goForwardInWorkspaceNavigation'
>

const MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES = 50

function createRestorableWorkspaceActions(set: ReposSet, get: ReposGet): RestorableWorkspaceActions {
  return {
    applySessionLayoutState(layoutState: Parameters<ReposStore['applySessionLayoutState']>[0]) {
      // One-shot boot/session restore of restorable layout fields. Runtime
      // edits are persisted later through useSessionPersistence.
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

function createRuntimeWorkspacePreferenceActions(set: ReposSet, get: ReposGet): RuntimeWorkspacePreferenceActions {
  // Shared post-write effects for view preferences that affect warm restore or
  // visible branch data. Centralized so each preference write stays coherent.
  function afterWorkspacePreferenceChange(id: string, repoInstanceId: string, branchForPullRequest: string | null): void {
    const repo = get().repos[id]
    if (!repo) return
    persistRepoSnapshotCacheEntry(set, repo, repoInstanceId)
    void runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id,
      repoInstanceId,
      branch: branchForPullRequest,
    })
  }

  return {
    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let changed = false
      let repoInstanceId: string | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.branchViewMode === viewMode) return s
        changed = true
        repoInstanceId = repo.instanceId
        return replaceRepoState(s, repo, (r) => {
          r.ui.branchViewMode = viewMode
        })
      })
      if (changed && repoInstanceId !== undefined) afterWorkspacePreferenceChange(id, repoInstanceId, null)
    },

    setWorkspacePaneTab(id: string, branch: string, tab: WorkspacePaneTabType) {
      // Persists the user's target-scoped preferred tab type verbatim.
      // Opening/closing branch tabs is owned by explicit open/close actions;
      // this action only changes the target-scoped preferred tab.
      let changed = false
      let repoInstanceId: string | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const branchModel = requireRepoBranchQueryProjection(repo)
        const target = workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: branchModel.branches },
          branch,
        )
        const current = preferredWorkspacePaneTabForTarget(repo.ui, target)
        if (!target || current === tab) return s
        changed = true
        repoInstanceId = repo.instanceId
        return replaceRepoState(s, repo, (r) => {
          r.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(r.ui, target, tab)
        })
      })
      if (!changed || repoInstanceId === undefined) return
      const repo = get().repos[id]
      const branchModel = repo ? requireRepoBranchQueryProjection(repo) : null
      const target =
        repo && branchModel
          ? workspacePaneTabsTargetForRepoBranch(
              { repoRoot: repo.id, branches: branchModel.branches },
              branch,
            )
          : null
      afterWorkspacePreferenceChange(
        id,
        repoInstanceId,
        repo && target && preferredWorkspacePaneTabForTarget(repo.ui, target) === 'status' ? branch : null,
      )
    },
  }
}

function createWorkspaceNavigationHistoryActions(
  set: ReposSet,
  get: ReposGet,
): WorkspaceNavigationHistoryActions {
  return {
    recordWorkspaceNavigation(entry) {
      set((s) => {
        const currentRepoHistory = navigationHistoryForRepo(s.navigationHistoryByRepo[entry.repoId])
        if (workspaceNavigationHistoryEntryEqual(currentRepoHistory.current, entry)) return s

        const nextRepoHistory: WorkspaceNavigationHistoryRepoState = {
          current: entry,
          backStack: currentRepoHistory.current
            ? [...currentRepoHistory.backStack, currentRepoHistory.current].slice(
                -MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
              )
            : currentRepoHistory.backStack,
          forwardStack: [],
        }

        return {
          navigationHistoryByRepo: {
            ...s.navigationHistoryByRepo,
            [entry.repoId]: nextRepoHistory,
          },
        }
      })
    },

    goBackInWorkspaceNavigation(repoId) {
      const history = navigationHistoryForRepo(get().navigationHistoryByRepo[repoId])
      const target = history.backStack.at(-1) ?? null
      if (!target || !history.current) return null

      set((s) => {
        const currentRepoHistory = navigationHistoryForRepo(s.navigationHistoryByRepo[repoId])
        const nextTarget = currentRepoHistory.backStack.at(-1) ?? null
        if (!nextTarget || !currentRepoHistory.current) return s
        return {
          navigationHistoryByRepo: {
            ...s.navigationHistoryByRepo,
            [repoId]: {
              current: nextTarget,
              backStack: currentRepoHistory.backStack.slice(0, -1),
              forwardStack: [currentRepoHistory.current, ...currentRepoHistory.forwardStack].slice(
                0,
                MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
              ),
            },
          },
        }
      })

      return target
    },

    goForwardInWorkspaceNavigation(repoId) {
      const history = navigationHistoryForRepo(get().navigationHistoryByRepo[repoId])
      const target = history.forwardStack[0] ?? null
      if (!target || !history.current) return null

      set((s) => {
        const currentRepoHistory = navigationHistoryForRepo(s.navigationHistoryByRepo[repoId])
        const nextTarget = currentRepoHistory.forwardStack[0] ?? null
        if (!nextTarget || !currentRepoHistory.current) return s
        return {
          navigationHistoryByRepo: {
            ...s.navigationHistoryByRepo,
            [repoId]: {
              current: nextTarget,
              backStack: [...currentRepoHistory.backStack, currentRepoHistory.current].slice(
                -MAX_WORKSPACE_NAVIGATION_HISTORY_ENTRIES,
              ),
              forwardStack: currentRepoHistory.forwardStack.slice(1),
            },
          },
        }
      })

      return target
    },
  }
}

function navigationHistoryForRepo(
  state: WorkspaceNavigationHistoryRepoState | undefined,
): WorkspaceNavigationHistoryRepoState {
  return state ?? { current: null, backStack: [], forwardStack: [] }
}

export function createSelectionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRestorableWorkspaceActions(set, get),
    ...createRuntimeWorkspacePreferenceActions(set, get),
    ...createWorkspaceNavigationHistoryActions(set, get),
  }
}
