import { arrayMove } from '@dnd-kit/sortable'
import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { replaceRepo, replaceRepoState } from '#/web/stores/repos/helpers.ts'
import { persistRestorableRepoSnapshot } from '#/web/stores/repos/persistence.ts'
import {
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  DEFAULT_WORKSPACE_LAYOUT,
  effectiveDetailCollapsed,
  normalizeDetailPaneSize,
  normalizeDetailPaneSizes,
  normalizeWorkspaceSessionLayoutState,
  workspaceLayoutAllowsDetailCollapse,
} from '#/shared/workspace-layout.ts'
import type {
  BranchViewMode,
  DetailTab,
  RepoWorkspaceLayout,
  ReposGet,
  ReposSet,
  ReposStore,
} from '#/web/stores/repos/types.ts'
import type { WorkspaceDetailPaneSizes } from '#/shared/workspace-layout.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'

type RestorableWorkspaceSelectionActions = Pick<
  ReposStore,
  | 'setActive'
  | 'reorderRepos'
  | 'cycleActive'
  | 'setDetailCollapsed'
  | 'toggleDetailCollapsed'
  | 'setDetailFocusMode'
  | 'toggleDetailFocusMode'
  | 'setWorkspaceLayout'
  | 'applySessionLayoutState'
  | 'applySessionSelectedTerminalState'
  | 'applySessionDetailTabByRepo'
  | 'setDetailPaneSize'
  | 'setDetailPaneSizes'
  | 'resetLayout'
  | 'setSelectedTerminal'
>

type LocalWorkspaceSelectionActions = Pick<ReposStore, 'setBranchSearchQuery'>

type RuntimeCoherentSelectionActions = Pick<
  ReposStore,
  'setBranchViewMode' | 'setDetailTab' | 'selectBranch'
>

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

    setDetailCollapsed(collapsed: boolean) {
      set((s) => {
        const next = effectiveDetailCollapsed(s.workspaceLayout, collapsed)
        return s.detailCollapsed === next ? s : { detailCollapsed: next }
      })
    },

    toggleDetailCollapsed() {
      set((s) => {
        if (!workspaceLayoutAllowsDetailCollapse(s.workspaceLayout)) return s
        return { detailCollapsed: !s.detailCollapsed }
      })
    },

    setDetailFocusMode(focused: boolean) {
      set((s) => {
        const detailFocusMode = s.workspaceLayout === 'top-bottom' && focused
        const detailCollapsed = detailFocusMode ? false : s.detailCollapsed
        return s.detailFocusMode === detailFocusMode && s.detailCollapsed === detailCollapsed
          ? s
          : { detailFocusMode, detailCollapsed }
      })
    },

    toggleDetailFocusMode() {
      set((s) => {
        if (s.workspaceLayout !== 'top-bottom') return s
        const detailFocusMode = !s.detailFocusMode
        const detailCollapsed = detailFocusMode ? false : s.detailCollapsed
        return { detailFocusMode, detailCollapsed }
      })
    },

    setWorkspaceLayout(layout: RepoWorkspaceLayout) {
      set((s) => {
        const detailFocusMode = layout === 'top-bottom' ? s.detailFocusMode : false
        const detailCollapsed = effectiveDetailCollapsed(layout, s.detailCollapsed)
        if (
          s.workspaceLayout === layout &&
          s.detailCollapsed === detailCollapsed &&
          s.detailFocusMode === detailFocusMode
        ) {
          return s
        }
        return { workspaceLayout: layout, detailCollapsed, detailFocusMode }
      })
    },

    applySessionLayoutState(layoutState: Parameters<ReposStore['applySessionLayoutState']>[0]) {
      // One-shot boot/session restore of restorable layout fields. Runtime
      // layout edits still originate from the renderer and are persisted later
      // through useSessionPersistence.
      set((s) => {
        const next = normalizeWorkspaceSessionLayoutState(layoutState)
        if (
          s.workspaceLayout === next.workspaceLayout &&
          s.detailCollapsed === next.detailCollapsed &&
          s.detailFocusMode === next.detailFocusMode &&
          s.detailPaneSizes['top-bottom'] === next.detailPaneSizes['top-bottom'] &&
          s.detailPaneSizes['left-right'] === next.detailPaneSizes['left-right']
        ) {
          return s
        }
        return {
          workspaceLayout: next.workspaceLayout,
          detailCollapsed: next.detailCollapsed,
          detailFocusMode: next.detailFocusMode,
          detailPaneSizes: next.detailPaneSizes,
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

    applySessionDetailTabByRepo(detailTabByRepo: Record<string, DetailTab>) {
      // One-shot boot/session restore of per-repo user-preferred detail tab.
      // The store does not project against terminal session count or
      // worktree presence — `useEffectiveDetailTab` handles that at read
      // time, which keeps the restored preference intact even if a
      // worktree later confirms zero sessions.
      set((s) => {
        let changed = false
        const repos = { ...s.repos }
        for (const [id, tab] of Object.entries(detailTabByRepo)) {
          const repo = repos[id]
          if (!repo) continue
          if (repo.ui.preferredDetailTab === tab) continue
          changed = true
          repos[id] = replaceRepo(repo, (r) => {
            r.ui.preferredDetailTab = tab
          })
        }
        return changed ? { repos } : s
      })
    },

    setDetailPaneSize(layout: RepoWorkspaceLayout, size: number) {
      set((s) => {
        const next = normalizeDetailPaneSize(layout, size)
        if (s.detailPaneSizes[layout] === next) return s
        return { detailPaneSizes: { ...s.detailPaneSizes, [layout]: next } }
      })
    },

    setDetailPaneSizes(sizes: WorkspaceDetailPaneSizes) {
      set((s) => {
        const next = normalizeDetailPaneSizes(sizes)
        if (
          s.detailPaneSizes['top-bottom'] === next['top-bottom'] &&
          s.detailPaneSizes['left-right'] === next['left-right']
        ) {
          return s
        }
        return { detailPaneSizes: next }
      })
    },

    resetLayout() {
      set((s) => {
        const detailCollapsed = effectiveDetailCollapsed(DEFAULT_WORKSPACE_LAYOUT, DEFAULT_DETAIL_COLLAPSED)
        if (
          s.workspaceLayout === DEFAULT_WORKSPACE_LAYOUT &&
          s.detailCollapsed === detailCollapsed &&
          !s.detailFocusMode &&
          s.detailPaneSizes['top-bottom'] === DEFAULT_DETAIL_PANE_SIZES['top-bottom'] &&
          s.detailPaneSizes['left-right'] === DEFAULT_DETAIL_PANE_SIZES['left-right']
        ) {
          return s
        }
        return {
          workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
          detailCollapsed,
          detailFocusMode: false,
          detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
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

function createLocalWorkspaceSelectionActions(set: ReposSet): LocalWorkspaceSelectionActions {
  return {
    setBranchSearchQuery(id: string, query: string) {
      set((s) => {
        if (!s.repos[id]) return s
        const hasQuery = query.trim().length > 0
        const currentQuery = s.branchSearchQueries[id]
        if (hasQuery ? currentQuery === query : currentQuery === undefined) return s
        const branchSearchQueries = { ...s.branchSearchQueries }
        if (hasQuery) branchSearchQueries[id] = query
        else delete branchSearchQueries[id]
        return { branchSearchQueries }
      })
    },
  }
}

function createRuntimeCoherentSelectionActions(set: ReposSet, get: ReposGet): RuntimeCoherentSelectionActions {
  // Shared post-write effects for actions that may have updated detailTab/branch:
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

    setDetailTab(id: string, tab: DetailTab) {
      // Persists the user's preferred tab verbatim. The store does *not*
      // project against worktree presence or terminal session count — the UI
      // computes the effective tab from this preference + live terminal
      // runtime via `computeEffectiveDetailTab`. This preserves user intent
      // across session restore, branch switches, and the transient zero-
      // session window between handleNewTerminal and createTerminal.
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.preferredDetailTab === tab) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.preferredDetailTab = tab
        })
      })
      if (!changed || token === undefined) return
      const repo = get().repos[id]
      afterSelectionChange(id, token, repo?.ui.preferredDetailTab === 'status' ? repo.ui.selectedBranch : null)
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
      if (repo.availability.phase === 'unavailable') return
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
    ...createLocalWorkspaceSelectionActions(set),
    ...createRuntimeCoherentSelectionActions(set, get),
    ...createRepoMutationSelectionActions(set, get),
  }
}
