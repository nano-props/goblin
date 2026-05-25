import { arrayMove } from '@dnd-kit/sortable'
import { branchForVisibleLog, selectedBranchForViewMode } from '#/renderer/stores/repos/branch-view-mode.ts'
import { replaceRepo, replaceRepoState } from '#/renderer/stores/repos/helpers.ts'
import { persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import {
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  DEFAULT_WORKSPACE_LAYOUT,
  effectiveDetailCollapsed,
  normalizeDetailPaneSize,
  normalizeDetailPaneSizes,
  workspaceLayoutAllowsDetailCollapse,
} from '#/shared/workspace-layout.ts'
import type {
  BranchViewMode,
  DetailTab,
  RepoWorkspaceLayout,
  ReposGet,
  ReposSet,
} from '#/renderer/stores/repos/types.ts'
import type { WorkspaceDetailPaneSizes } from '#/shared/workspace-layout.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { detailTabForWorktree } from '#/renderer/lib/detail-tabs.ts'
import {
  runBranchViewModeChangedWorkflow,
  runDetailTabChangedWorkflow,
  runSelectedBranchChangedWorkflow,
  runSelectedBranchStatusWorkflow,
} from '#/renderer/stores/repos/refresh-workflows.ts'

function branchHasWorktree(repo: RepoState, branchName: string | null): boolean {
  return !!branchName && repo.data.branches.some((branch) => branch.name === branchName && !!branch.worktreePath)
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

    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let changed = false
      let selectedForLog: string | null = null
      let selectedForPullRequest: string | null = null
      let shouldRefreshLog = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.branchViewMode === viewMode) return s
        changed = true
        token = repo.instanceToken
        const selectedBranch = selectedBranchForViewMode(repo, viewMode)
        const selectionChanged = selectedBranch !== repo.ui.selectedBranch
        selectedForLog = selectedBranch
        selectedForPullRequest = selectionChanged ? selectedBranch : null
        shouldRefreshLog = selectionChanged && selectedBranch !== null && repo.ui.detailTab === 'commits'
        return replaceRepoState(s, repo, (r) => {
          r.ui.branchViewMode = viewMode
          r.ui.selectedBranch = selectedBranch
          r.ui.detailTab = detailTabForSelection(repo, r.ui.detailTab, selectedBranch)
          if (selectionChanged) {
            r.ui.commitDetail = { phase: 'idle' }
          }
        })
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        runBranchViewModeChangedWorkflow(get, {
          id,
          token,
          selectedForLog,
          selectedForPullRequest,
          shouldRefreshLog,
        })
      }
    },

    setDetailTab(id: string, tab: DetailTab) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const nextTab = detailTabForSelection(repo, tab)
        if (repo.ui.detailTab === nextTab && repo.ui.commitDetail.phase === 'idle') return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.detailTab = nextTab
          r.ui.commitDetail = { phase: 'idle' }
        })
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        runDetailTabChangedWorkflow(get, {
          id,
          token,
          tab: repo.ui.detailTab,
          selectedBranch: repo.ui.selectedBranch,
        })
      }
    },

    dismissExitedTerminalDetail(id: string, worktreePath: string) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.ui.detailTab !== 'terminal') return s
        const branch = repo.data.branches.find((branch) => branch.name === repo.ui.selectedBranch)
        if (branch?.worktreePath !== worktreePath) return s
        changed = true
        token = repo.instanceToken
        const nextRepo = replaceRepo(repo, (r) => {
          r.ui.detailTab = 'status'
          r.ui.commitDetail = { phase: 'idle' }
        })
        const detailCollapsed =
          s.activeId === id ? effectiveDetailCollapsed(s.workspaceLayout, true) : s.detailCollapsed
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
        runSelectedBranchStatusWorkflow(get, { id, token, selectedBranch: repo.ui.selectedBranch })
      }
    },

    selectBranch(id: string, branch: string) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (!repo.data.branches.some((b) => b.name === branch)) return s
        if (repo.ui.selectedBranch === branch && repo.ui.commitDetail.phase === 'idle') return s
        changed = true
        token = repo.instanceToken
        return replaceRepoState(s, repo, (r) => {
          r.ui.selectedBranch = branch
          r.ui.detailTab = detailTabForSelection(repo, r.ui.detailTab, branch)
          r.ui.commitDetail = { phase: 'idle' }
        })
      })
      const repo = get().repos[id]
      if (changed && token !== undefined && repo) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo) {
        runSelectedBranchChangedWorkflow(get, { id, token, branch, tab: repo.ui.detailTab })
      }
    },

    selectLog(id: string, branch: string, hash: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const prev = repo.data.logsByBranch[branch]
        if (!prev) return s
        if (!prev.entries.some((entry) => entry.hash === hash) || prev.selectedHash === hash) return s
        return replaceRepoState(s, repo, (r) => {
          r.data.logsByBranch[branch]!.selectedHash = hash
        })
      })
    },

    async checkoutSelected() {
      const state = get()
      const id = state.activeId
      if (!id) return
      const repo = state.repos[id]
      if (!repo) return
      const token = repo.instanceToken
      const branch = repo.ui.selectedBranch
      if (!branch || branch === repo.data.currentBranch) return
      const branchInfo = repo.data.branches.find((b) => b.name === branch)
      if (!branchInfo || branchInfo.worktreePath) return
      await get().runBranchAction(id, { kind: 'checkout', branch }, { token })
    },

    async openSelectedCommit() {
      const state = get()
      const id = state.activeId
      if (!id) return
      const repo = state.repos[id]
      if (!repo || repo.ui.detailTab !== 'commits') return
      const branch = branchForVisibleLog(repo)
      if (!branch) return
      const branchLog = repo.data.logsByBranch[branch]
      const hash = branchLog?.selectedHash ?? branchLog?.entries[0]?.hash
      if (!hash) return
      await get().openCommit(id, hash)
    },
  }
}
