import { arrayMove } from '@dnd-kit/sortable'
import { selectedBranchForViewMode } from '#/web/stores/repos/branch-view-mode.ts'
import { replaceRepo, replaceRepoState } from '#/web/stores/repos/helpers.ts'
import { persistRepoCache } from '#/web/stores/repos/persistence.ts'
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
import type { RepoState } from '#/web/stores/repos/types.ts'
import { detailTabForWorktree } from '#/web/lib/detail-tabs.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
function branchHasWorktree(repo: RepoState, branchName: string | null): boolean {
  return !!branchName && repo.data.branches.some((branch) => branch.name === branchName && !!branch.worktree?.path)
}

function detailTabForSelection(repo: RepoState, tab: DetailTab, selectedBranch = repo.ui.selectedBranch): DetailTab {
  return detailTabForWorktree(tab, branchHasWorktree(repo, selectedBranch))
}

export function createSelectionActions(set: ReposSet, get: ReposGet) {
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
      // One-shot boot/session restore of persistable layout fields. Runtime
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
          r.ui.detailTab = detailTabForSelection(repo, r.ui.detailTab, selectedBranch)
        })
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        void runRepoRefreshIntent(get, {
          kind: 'branch-view-mode-changed',
          id,
          token,
          selectedForPullRequest,
        })
      }
    },

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

    setDetailTab(id: string, tab: DetailTab) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const nextTab = detailTabForSelection(repo, tab)
        if (repo.ui.detailTab === nextTab) return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.detailTab = nextTab
        })
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        void runRepoRefreshIntent(get, {
          kind: 'detail-tab-changed',
          id,
          token,
          tab: repo.ui.detailTab,
          selectedBranch: repo.ui.selectedBranch,
        })
      }
    },

    dismissExitedTerminalDetail(id: string, worktreePath: string, options?: { affectVisibleWorkspace?: boolean }) {
      let changed = false
      let token: number | undefined
      const affectVisibleWorkspace = options?.affectVisibleWorkspace === true
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.detailTab !== 'terminal') return s
        const branch = repo.data.branches.find((branch) => branch.name === repo.ui.selectedBranch)
        if (branch?.worktree?.path !== worktreePath) return s
        changed = true
        token = repo.instanceToken
        const nextRepo = replaceRepo(repo, (r) => {
          r.ui.detailTab = 'status'
        })
        const detailCollapsed = affectVisibleWorkspace
          ? effectiveDetailCollapsed(s.workspaceLayout, true)
          : s.detailCollapsed
        if (nextRepo === repo && detailCollapsed === s.detailCollapsed) return s
        if (nextRepo === repo) return { detailCollapsed }
        return {
          // Terminal exits in background repos should not surprise the active workspace layout.
          detailCollapsed,
          repos: { ...s.repos, [id]: nextRepo },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        void runRepoRefreshIntent(get, {
          kind: 'selected-branch-status',
          id,
          token,
          selectedBranch: repo.ui.selectedBranch,
        })
      }
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
          r.ui.detailTab = detailTabForSelection(repo, r.ui.detailTab, branch)
        })
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        void runRepoRefreshIntent(get, {
          kind: 'selected-branch-changed',
          id,
          token,
          branch,
          tab: repo.ui.detailTab,
        })
      }
    },

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
