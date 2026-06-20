import { arrayMove } from '@dnd-kit/sortable'
import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { isRepoUnavailable, replaceRepo, replaceRepoState } from '#/web/stores/repos/helpers.ts'
import { persistRestorableRepoSnapshot } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_BRANCH_LIST_PANE_VISIBLE,
  DEFAULT_WORKSPACE_PANE_SIZES,
  normalizeWorkspacePaneSize,
  normalizeWorkspacePaneSizes,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type {
  BranchViewMode,
  RepoWorkspaceLayout,
  ReposGet,
  ReposSet,
  ReposStore,
} from '#/web/stores/repos/types.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneSizes } from '#/shared/workspace-layout.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'

type RestorableWorkspaceSelectionActions = Pick<
  ReposStore,
  | 'setActive'
  | 'reorderRepos'
  | 'cycleActive'
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'applySessionWorkspacePaneViewByRepo'
  | 'setBranchListPaneVisible'
  | 'toggleBranchListPaneVisible'
  | 'setWorkspacePaneSize'
  | 'setWorkspacePaneSizes'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type RuntimeCoherentSelectionActions = Pick<ReposStore, 'setBranchViewMode' | 'setWorkspacePaneView' | 'selectBranch'>

type RepoMutationSelectionActions = Pick<ReposStore, 'checkoutSelectedInRepo' | 'checkoutSelected'>

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
          s.branchListPaneVisible === next.branchListPaneVisible &&
          s.workspacePaneSizes['left-right'] === next.workspacePaneSizes['left-right']
        ) {
          return s
        }
        return {
          branchListPaneVisible: next.branchListPaneVisible,
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
          if (repo.ui.preferredWorkspacePaneView === tab) continue
          changed = true
          repos[id] = replaceRepo(repo, (r) => {
            r.ui.preferredWorkspacePaneView = tab
          })
        }
        return changed ? { repos } : s
      })
    },

    setBranchListPaneVisible(visible: boolean) {
      set((s) => (s.branchListPaneVisible === visible ? s : { branchListPaneVisible: visible }))
    },

    toggleBranchListPaneVisible() {
      set((s) => ({ branchListPaneVisible: !s.branchListPaneVisible }))
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
          s.branchListPaneVisible === DEFAULT_BRANCH_LIST_PANE_VISIBLE &&
          s.workspacePaneSizes['left-right'] === DEFAULT_WORKSPACE_PANE_SIZES['left-right']
        ) {
          return s
        }
        return {
          branchListPaneVisible: DEFAULT_BRANCH_LIST_PANE_VISIBLE,
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
      // Persists the user's preferred view type verbatim. The store does *not*
      // project against worktree presence, terminal session count, or opened
      // workspace pane views — the UI resolves the active pane from this preference and
      // live terminal runtime state. This preserves user intent across session
      // restore, branch switches, and the transient zero-session window between
      // handleNewTerminal and createTerminal.
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.preferredWorkspacePaneView === tab) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
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
  }
}

function createRepoMutationSelectionActions(set: ReposSet, get: ReposGet): RepoMutationSelectionActions {
  return {
    async checkoutSelectedInRepo(id: string) {
      const state = get()
      const repo = state.repos[id]
      if (!repo) return
      if (isRepoUnavailable(repo)) return
      const token = repo.instanceToken
      const branch = repo.ui.selectedBranch
      if (!branch || branch === repo.data.currentBranch) return
      const branchInfo = repo.data.branches.find((b) => b.name === branch)
      if (!branchInfo || branchInfo.worktree?.path) return
      await get().runBranchAction(id, { kind: 'checkout', branch }, { token })
    },

    async checkoutSelected() {
      const id = get().activeId
      if (!id) return
      await get().checkoutSelectedInRepo(id)
    },
  }
}

export function createSelectionActions(set: ReposSet, get: ReposGet) {
  return {
    ...createRestorableWorkspaceSelectionActions(set, get),
    ...createRuntimeCoherentSelectionActions(set, get),
    ...createRepoMutationSelectionActions(set, get),
  }
}
