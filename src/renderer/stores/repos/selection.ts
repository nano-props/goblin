import { arrayMove } from '@dnd-kit/sortable'
import { branchForVisibleLog, selectedBranchForViewMode } from '#/renderer/stores/repos/branch-view-mode.ts'
import type { BranchViewMode, DetailTab, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'

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
      set((s) => (s.detailCollapsed === collapsed ? s : { detailCollapsed: collapsed }))
    },

    toggleDetailCollapsed() {
      set((s) => ({ detailCollapsed: !s.detailCollapsed }))
    },

    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      let selectedForLog: string | null = null
      let selectedForPullRequest: string | null = null
      let shouldRefreshLog = false
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.branchViewMode === viewMode) return s
        const selectedBranch = selectedBranchForViewMode(repo, viewMode)
        const selectionChanged = selectedBranch !== repo.selectedBranch
        selectedForLog = selectedBranch
        selectedForPullRequest = selectionChanged ? selectedBranch : null
        shouldRefreshLog = selectionChanged && selectedBranch !== null && repo.detailTab === 'commits'
        return {
          repos: {
            ...s.repos,
            [id]: {
              ...repo,
              branchViewMode: viewMode,
              selectedBranch,
              openCommit: selectionChanged ? null : repo.openCommit,
              openingCommitHash: selectionChanged ? null : repo.openingCommitHash,
            },
          },
        }
      })
      if (shouldRefreshLog && selectedForLog) void get().refreshBranchLog(id, selectedForLog)
      if (selectedForPullRequest) {
        void get().refreshPullRequests(id, [selectedForPullRequest], { mode: 'full', silent: true })
      }
    },

    setDetailTab(id: string, tab: DetailTab) {
      let changed = false
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (repo.detailTab === tab && repo.openCommit === null && repo.openingCommitHash === null) return s
        changed = true
        return { repos: { ...s.repos, [id]: { ...repo, detailTab: tab, openCommit: null, openingCommitHash: null } } }
      })
      if (changed && tab === 'commits') void get().refreshBranchLog(id)
      if (changed && tab === 'changes') void get().refreshStatus(id)
      if (changed && tab === 'status') {
        const repo = get().repos[id]
        if (repo?.selectedBranch) {
          void get().refreshPullRequests(id, [repo.selectedBranch], { mode: 'full', silent: true })
        }
      }
    },

    selectBranch(id: string, branch: string) {
      let changed = false
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (!repo.branches.some((b) => b.name === branch)) return s
        if (repo.selectedBranch === branch && repo.openCommit === null && repo.openingCommitHash === null) return s
        changed = true
        return {
          repos: {
            ...s.repos,
            [id]: { ...repo, selectedBranch: branch, openCommit: null, openingCommitHash: null },
          },
        }
      })
      const repo = get().repos[id]
      if (changed && repo?.detailTab === 'commits') void get().refreshBranchLog(id, branch)
      if (changed) void get().refreshPullRequests(id, [branch], { mode: 'full', silent: true })
    },

    selectLog(id: string, branch: string, hash: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const prev = repo.logsByBranch[branch] ?? { entries: [], selectedHash: null, loading: false }
        if (!prev.entries.some((entry) => entry.hash === hash) || prev.selectedHash === hash) return s
        return {
          repos: {
            ...s.repos,
            [id]: { ...repo, logsByBranch: { ...repo.logsByBranch, [branch]: { ...prev, selectedHash: hash } } },
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
      const branch = repo.selectedBranch
      if (!branch || branch === repo.currentBranch) return
      const branchInfo = repo.branches.find((b) => b.name === branch)
      if (!branchInfo || branchInfo.worktreePath) return
      try {
        const result = await window.gbl.checkout(id, branch)
        get().setLastResult(id, result, token)
        await get().refreshSnapshot(id, { token })
        await get().refreshStatus(id, { token })
      } catch (err) {
        get().setLastResult(id, { ok: false, message: err instanceof Error ? err.message : String(err) }, token)
      }
    },

    async openSelectedCommit() {
      const state = get()
      const id = state.activeId
      if (!id) return
      const repo = state.repos[id]
      if (!repo || repo.detailTab !== 'commits') return
      const branch = branchForVisibleLog(repo)
      if (!branch) return
      const branchLog = repo.logsByBranch[branch]
      const hash = branchLog?.selectedHash ?? branchLog?.entries[0]?.hash
      if (!hash) return
      await get().openCommit(id, hash)
    },
  }
}
