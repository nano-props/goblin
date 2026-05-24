import { arrayMove } from '@dnd-kit/sortable'
import { branchForVisibleLog, selectedBranchForViewMode } from '#/renderer/stores/repos/branch-view-mode.ts'
import { replaceRepo } from '#/renderer/stores/repos/helpers.ts'
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

    setWorkspaceLayout(layout: RepoWorkspaceLayout) {
      set((s) => {
        const detailCollapsed = effectiveDetailCollapsed(layout, s.detailCollapsed)
        if (s.workspaceLayout === layout && s.detailCollapsed === detailCollapsed) return s
        return { workspaceLayout: layout, detailCollapsed }
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
          s.detailPaneSizes['top-bottom'] === DEFAULT_DETAIL_PANE_SIZES['top-bottom'] &&
          s.detailPaneSizes['left-right'] === DEFAULT_DETAIL_PANE_SIZES['left-right']
        ) {
          return s
        }
        return {
          workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
          detailCollapsed,
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
        return {
          repos: {
            ...s.repos,
            [id]: replaceRepo(repo, (r) => {
              r.ui.branchViewMode = viewMode
              r.ui.selectedBranch = selectedBranch
              if (selectionChanged) {
                r.ui.commitDetail = { phase: 'idle' }
              }
            }),
          },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined) persistRepoCache(set, repo, token)
      if (shouldRefreshLog && selectedForLog && token !== undefined) {
        void get().refreshBranchLog(id, selectedForLog, { token })
      }
      if (selectedForPullRequest && token !== undefined) {
        void get().refreshPullRequests(id, [selectedForPullRequest], { token, mode: 'full' })
      }
    },

    setDetailTab(id: string, tab: DetailTab) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (repo.ui.detailTab === tab && repo.ui.commitDetail.phase === 'idle') return s
        changed = true
        token = repo.instanceToken
        return {
          repos: {
            ...s.repos,
            [id]: replaceRepo(repo, (r) => {
              r.ui.detailTab = tab
              r.ui.commitDetail = { phase: 'idle' }
            }),
          },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && tab === 'commits') void get().refreshBranchLog(id, undefined, { token })
      if (changed && token !== undefined && tab === 'changes') void get().refreshStatus(id, { token })
      if (changed && token !== undefined && tab === 'status') {
        if (repo?.ui.selectedBranch) {
          void get().refreshPullRequests(id, [repo.ui.selectedBranch], { token, mode: 'full' })
        }
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
        return {
          repos: {
            ...s.repos,
            [id]: replaceRepo(repo, (r) => {
              r.ui.selectedBranch = branch
              r.ui.commitDetail = { phase: 'idle' }
            }),
          },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined) persistRepoCache(set, repo, token)
      if (changed && token !== undefined && repo?.ui.detailTab === 'commits') {
        void get().refreshBranchLog(id, branch, { token })
      }
      if (changed && token !== undefined) {
        void get().refreshPullRequests(id, [branch], { token, mode: 'full' })
      }
    },

    selectLog(id: string, branch: string, hash: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const prev = repo.data.logsByBranch[branch]
        if (!prev) return s
        if (!prev.entries.some((entry) => entry.hash === hash) || prev.selectedHash === hash) return s
        return {
          repos: {
            ...s.repos,
            [id]: replaceRepo(repo, (r) => {
              r.data.logsByBranch[branch] = { ...prev, selectedHash: hash }
            }),
          },
        }
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
