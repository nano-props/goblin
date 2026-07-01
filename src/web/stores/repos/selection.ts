import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { replaceRepoState } from '#/web/stores/repos/repo-state-factory.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspacePaneSize,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type { BranchViewMode, RepoState, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  preferredWorkspacePaneTabForBranch,
  preferredWorkspacePaneTabByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'

type RestorableWorkspaceSelectionActions = Pick<
  ReposStore,
  | 'setActive'
  | 'cycleActive'
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'setZenMode'
  | 'toggleZenMode'
  | 'setWorkspacePaneSize'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type RuntimeCoherentSelectionActions = Pick<
  ReposStore,
  'setBranchViewMode' | 'setWorkspacePaneTab' | 'selectBranch' | 'clearSelectedBranch'
>

function createRestorableWorkspaceSelectionActions(set: ReposSet, get: ReposGet): RestorableWorkspaceSelectionActions {
  return {
    setActive(id: string) {
      set((s) => (s.repos[id] && s.activeId !== id ? { activeId: id } : s))
    },

    cycleActive(direction: 1 | -1) {
      const { order, activeId } = get()
      if (order.length === 0) return
      const idx = activeId ? order.indexOf(activeId) : -1
      const nextIdx = idx === -1 ? 0 : (idx + direction + order.length) % order.length
      const next = order[nextIdx]
      if (next && next !== activeId) set({ activeId: next })
    },

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

function createRuntimeCoherentSelectionActions(set: ReposSet, get: ReposGet): RuntimeCoherentSelectionActions {
  // Shared post-write effects for actions that may have updated preferred workspace pane tab/branch:
  // persist the warm-restore snapshot and refresh the visible branch's pull
  // request. Centralized so every selection-changing action stays consistent.
  function afterSelectionChange(id: string, token: number, branchForPullRequest: string | null): void {
    const repo = get().repos[id]
    if (!repo) return
    persistRepoSnapshotCacheEntry(set, repo, token)
    void runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id,
      token,
      branch: branchForPullRequest,
    })
  }

  return {
    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let changed = false
      let selectedForPullRequest: string | null = null
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.branchViewMode === viewMode) return s
        changed = true
        token = repo.instanceToken
        const selectedBranch = selectedBranchForViewMode(repo, viewMode)
        const selectionChanged = selectedBranch !== repo.ui.selectedBranch
        selectedForPullRequest = selectionChanged ? selectedBranch : null
        return replaceRepoState(s, repo, (r) => {
          r.ui.branchViewMode = viewMode
          r.ui.selectedBranch = selectedBranch
        })
      })
      if (changed && token !== undefined) afterSelectionChange(id, token, selectedForPullRequest)
    },

    setWorkspacePaneTab(id: string, tab: WorkspacePaneTabType) {
      // Persists the user's branch-scoped preferred tab type verbatim.
      // Opening/closing branch tabs is owned by explicit open/close actions;
      // this action only changes selection intent.
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        const branch = repo?.ui.selectedBranch
        const current = repo ? preferredWorkspacePaneTabForBranch(repo.ui, branch) : null
        if (!repo || !branch || current === tab) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          const selectedBranch = r.ui.selectedBranch
          if (selectedBranch) {
            r.ui.preferredWorkspacePaneTabByBranch = preferredWorkspacePaneTabByBranchRecordWith(
              r.ui,
              selectedBranch,
              tab,
            )
          }
        })
      })
      if (!changed || token === undefined) return
      const repo = get().repos[id]
      afterSelectionChange(
        id,
        token,
        repo && preferredWorkspacePaneTabForBranch(repo.ui, repo.ui.selectedBranch) === 'status'
          ? repo.ui.selectedBranch
          : null,
      )
    },

    selectBranch(id: string, branch: string) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (!repo.data.branches.some((b) => b.name === branch)) return s
        if (repo.ui.selectedBranch === branch) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.selectedBranch = branch
        })
      })
      if (changed && token !== undefined) afterSelectionChange(id, token, branch)
    },

    clearSelectedBranch(id: string) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.selectedBranch === null) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.selectedBranch = null
        })
      })
      if (changed && token !== undefined) afterSelectionChange(id, token, null)
    },
  }
}

export function createSelectionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRestorableWorkspaceSelectionActions(set, get),
    ...createRuntimeCoherentSelectionActions(set, get),
  }
}
