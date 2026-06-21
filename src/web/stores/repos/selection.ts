import { arrayMove } from '@dnd-kit/sortable'
import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { replaceRepo, replaceRepoState } from '#/web/stores/repos/helpers.ts'
import { persistRestorableRepoSnapshot } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_WORKSPACE_FOCUSED,
  DEFAULT_WORKSPACE_PANE_SIZES,
  normalizeWorkspacePaneSize,
  normalizeWorkspacePaneSizes,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type { BranchViewMode, RepoWorkspaceLayout, ReposGet, ReposSet, ReposStore } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneBranchViewType, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneSizes } from '#/shared/workspace-layout.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import {
  branchWorkspacePaneViewsForBranch,
  branchWorkspacePaneViewsRecordWith,
} from '#/web/stores/repos/branch-workspace-pane-views.ts'

type RestorableWorkspaceSelectionActions = Pick<
  ReposStore,
  | 'setActive'
  | 'reorderRepos'
  | 'cycleActive'
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'applySessionWorkspacePaneViewByRepo'
  | 'setWorkspaceFocused'
  | 'toggleWorkspaceFocused'
  | 'setWorkspacePaneSize'
  | 'setWorkspacePaneSizes'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type RuntimeCoherentSelectionActions = Pick<
  ReposStore,
  | 'setBranchViewMode'
  | 'setWorkspacePaneView'
  | 'openBranchWorkspacePaneView'
  | 'closeBranchWorkspacePaneView'
  | 'reorderBranchWorkspacePaneViews'
  | 'selectBranch'
  | 'clearSelectedBranch'
>

function createRestorableWorkspaceSelectionActions(set: ReposSet, get: ReposGet): RestorableWorkspaceSelectionActions {
  return {
    setActive(id: string) {
      set((s) => (s.repos[id] && s.activeId !== id ? { activeId: id } : s))
    },

    reorderRepos(fromId: string, toId: string) {
      if (fromId === toId) return
      set((s) => {
        const from = s.order.indexOf(fromId)
        const to = s.order.indexOf(toId)
        if (from === -1 || to === -1) return s
        return { order: arrayMove(s.order, from, to) }
      })
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
        if (
          s.workspaceFocused === next.workspaceFocused &&
          s.workspacePaneSizes['left-right'] === next.workspacePaneSizes['left-right']
        ) {
          return s
        }
        return {
          workspaceFocused: next.workspaceFocused,
          workspacePaneSizes: next.workspacePaneSizes,
        }
      })
    },

    applySessionSelectedTerminalState(selectedTerminalByWorktree: Record<string, string>) {
      // One-shot boot/session restore of per-worktree terminal selection. This
      // seeds renderer state; later selection changes remain renderer-owned.
      set((s) => {
        const current = s.selectedTerminalByWorktree
        const currentEntries = Object.entries(current)
        const nextEntries = Object.entries(selectedTerminalByWorktree)
        if (
          currentEntries.length === nextEntries.length &&
          nextEntries.every(([worktreeKey, key]) => current[worktreeKey] === key)
        ) {
          return s
        }
        return { selectedTerminalByWorktree: { ...selectedTerminalByWorktree } }
      })
    },

    applySessionWorkspacePaneViewByRepo(workspacePaneViewByRepo: Record<string, WorkspacePaneView>) {
      // One-shot boot/session restore of per-repo user-preferred workspace pane view.
      // The store does not project against terminal session count or
      // worktree presence — `useEffectiveWorkspacePaneView` handles that at read
      // time, which keeps the restored preference intact even if a
      // worktree later confirms zero sessions.
      set((s) => {
        let changed = false
        const repos = { ...s.repos }
        for (const [id, tab] of Object.entries(workspacePaneViewByRepo)) {
          const repo = repos[id]
          if (!repo) continue
          const openBranchViews = branchWorkspacePaneViewsForBranch(repo.ui, repo.ui.selectedBranch)
          const branchViewNeedsOpen =
            isBranchWorkspacePaneView(tab) && !!repo.ui.selectedBranch && !openBranchViews.includes(tab)
          if (repo.ui.preferredWorkspacePaneView === tab && !branchViewNeedsOpen) continue
          changed = true
          repos[id] = replaceRepo(repo, (r) => {
            const branch = r.ui.selectedBranch
            if (branch && isBranchWorkspacePaneView(tab)) {
              const current = branchWorkspacePaneViewsForBranch(r.ui, branch)
              if (!current.includes(tab)) {
                r.ui.openBranchWorkspacePaneViewsByBranch = branchWorkspacePaneViewsRecordWith(r.ui, branch, [
                  ...current,
                  tab,
                ])
              }
            }
            r.ui.preferredWorkspacePaneView = tab
          })
        }
        return changed ? { repos } : s
      })
    },

    setWorkspaceFocused(enabled: boolean) {
      set((s) => (s.workspaceFocused === enabled ? s : { workspaceFocused: enabled }))
    },

    toggleWorkspaceFocused() {
      set((s) => ({ workspaceFocused: !s.workspaceFocused }))
    },

    setWorkspacePaneSize(layout: RepoWorkspaceLayout, size: number) {
      set((s) => {
        const next = normalizeWorkspacePaneSize(layout, size)
        if (s.workspacePaneSizes[layout] === next) return s
        return { workspacePaneSizes: { ...s.workspacePaneSizes, [layout]: next } }
      })
    },

    setWorkspacePaneSizes(sizes: WorkspacePaneSizes) {
      set((s) => {
        const next = normalizeWorkspacePaneSizes(sizes)
        if (s.workspacePaneSizes['left-right'] === next['left-right']) {
          return s
        }
        return { workspacePaneSizes: next }
      })
    },

    resetLayout() {
      set((s) => {
        if (
          s.workspaceFocused === DEFAULT_WORKSPACE_FOCUSED &&
          s.workspacePaneSizes['left-right'] === DEFAULT_WORKSPACE_PANE_SIZES['left-right']
        ) {
          return s
        }
        return {
          workspaceFocused: DEFAULT_WORKSPACE_FOCUSED,
          workspacePaneSizes: DEFAULT_WORKSPACE_PANE_SIZES,
        }
      })
    },

    setSelectedTerminal(worktreeTerminalKey: string, key: string | null) {
      set((s) => {
        const current = s.selectedTerminalByWorktree[worktreeTerminalKey]
        if (key) {
          if (current === key) return s
          return { selectedTerminalByWorktree: { ...s.selectedTerminalByWorktree, [worktreeTerminalKey]: key } }
        }
        if (current === undefined) return s
        const selectedTerminalByWorktree = { ...s.selectedTerminalByWorktree }
        delete selectedTerminalByWorktree[worktreeTerminalKey]
        return { selectedTerminalByWorktree }
      })
    },
  }
}

function createRuntimeCoherentSelectionActions(set: ReposSet, get: ReposGet): RuntimeCoherentSelectionActions {
  // Shared post-write effects for actions that may have updated workspacePaneView/branch:
  // persist the warm-restore snapshot and refresh the visible branch's pull
  // request. Centralized so every selection-changing action stays consistent.
  function afterSelectionChange(id: string, token: number, branchForPullRequest: string | null): void {
    const repo = get().repos[id]
    if (!repo) return
    persistRestorableRepoSnapshot(set, repo, token)
    void runRepoRefreshIntent(get, {
      kind: 'visible-pull-request-changed',
      id,
      token,
      branch: branchForPullRequest,
    })
  }

  return {
    openBranchWorkspacePaneView(id: string, tab: WorkspacePaneBranchViewType, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = branchWorkspacePaneViewsForBranch(repo.ui, branch)
        if (current.includes(tab)) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.openBranchWorkspacePaneViewsByBranch = branchWorkspacePaneViewsRecordWith(r.ui, branch, [
            ...current,
            tab,
          ])
        })
      })
    },

    closeBranchWorkspacePaneView(id: string, tab: WorkspacePaneBranchViewType, branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = branchWorkspacePaneViewsForBranch(repo.ui, branch)
        if (!current.includes(tab)) return s
        const next = current.filter((view) => view !== tab)
        return replaceRepoState(s, repo, (r) => {
          r.ui.openBranchWorkspacePaneViewsByBranch = branchWorkspacePaneViewsRecordWith(r.ui, branch, next)
        })
      })
    },

    reorderBranchWorkspacePaneViews(id: string, orderedViews: WorkspacePaneBranchViewType[], branchName?: string) {
      set((s) => {
        const repo = s.repos[id]
        const branch = branchName ?? repo?.ui.selectedBranch
        if (!repo || !branch) return s
        const current = branchWorkspacePaneViewsForBranch(repo.ui, branch)
        if (orderedViews.length !== current.length) return s
        const next = orderedViews.filter(isBranchWorkspacePaneView)
        if (next.length !== orderedViews.length || new Set(next).size !== next.length) return s
        const currentSet = new Set(current)
        if (!next.every((view) => currentSet.has(view))) return s
        if (next.every((view, index) => view === current[index])) return s
        return replaceRepoState(s, repo, (r) => {
          r.ui.openBranchWorkspacePaneViewsByBranch = branchWorkspacePaneViewsRecordWith(r.ui, branch, next)
        })
      })
    },

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

    setWorkspacePaneView(id: string, tab: WorkspacePaneView) {
      // Persists the user's preferred view type verbatim. Branch-scoped views
      // are reopened here so selecting "Status" restores the tab; worktree
      // presence, terminal session count, and worktree-scoped open views are
      // still resolved by the UI from live terminal runtime state. This
      // preserves user intent across session restore, branch switches, and the
      // transient zero-session window between handleNewTerminal and
      // createTerminal.
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        const branch = repo?.ui.selectedBranch
        const openBranchViews = repo ? branchWorkspacePaneViewsForBranch(repo.ui, branch) : []
        const branchViewNeedsOpen = isBranchWorkspacePaneView(tab) && !!branch && !openBranchViews.includes(tab)
        if (!repo || (repo.ui.preferredWorkspacePaneView === tab && !branchViewNeedsOpen)) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          const selectedBranch = r.ui.selectedBranch
          if (selectedBranch && isBranchWorkspacePaneView(tab)) {
            const current = branchWorkspacePaneViewsForBranch(r.ui, selectedBranch)
            if (!current.includes(tab)) {
              r.ui.openBranchWorkspacePaneViewsByBranch = branchWorkspacePaneViewsRecordWith(r.ui, selectedBranch, [
                ...current,
                tab,
              ])
            }
          }
          r.ui.preferredWorkspacePaneView = tab
        })
      })
      if (!changed || token === undefined) return
      const repo = get().repos[id]
      afterSelectionChange(id, token, repo?.ui.preferredWorkspacePaneView === 'status' ? repo.ui.selectedBranch : null)
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

function isBranchWorkspacePaneView(tab: WorkspacePaneView): tab is WorkspacePaneBranchViewType {
  return tab === 'status' || tab === 'history'
}
