import { arrayMove } from '@dnd-kit/sortable'
import { branchForVisibleLog, selectedBranchForViewMode } from '#/renderer/stores/repos/branch-view-mode.ts'
import { persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import type { BranchViewMode, DetailTab, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import { rpc } from '#/renderer/rpc.ts'

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
            [id]: {
              ...repo,
              ui: {
                ...repo.ui,
                branchViewMode: viewMode,
                selectedBranch,
                openCommit: selectionChanged ? null : repo.ui.openCommit,
                openingCommitHash: selectionChanged ? null : repo.ui.openingCommitHash,
              },
            },
          },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined) persistRepoCache(set, repo, token)
      if (shouldRefreshLog && selectedForLog) void get().refreshBranchLog(id, selectedForLog)
      if (selectedForPullRequest) {
        void get().refreshPullRequests(id, [selectedForPullRequest], { mode: 'full', silent: true })
      }
    },

    setDetailTab(id: string, tab: DetailTab) {
      let changed = false
      let token: number | undefined
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (repo.ui.detailTab === tab && repo.ui.openCommit === null && repo.ui.openingCommitHash === null) return s
        changed = true
        token = repo.instanceToken
        return {
          repos: {
            ...s.repos,
            [id]: { ...repo, ui: { ...repo.ui, detailTab: tab, openCommit: null, openingCommitHash: null } },
          },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined) persistRepoCache(set, repo, token)
      if (changed && tab === 'commits') void get().refreshBranchLog(id)
      if (changed && tab === 'changes') void get().refreshStatus(id)
      if (changed && tab === 'status') {
        if (repo?.ui.selectedBranch) {
          void get().refreshPullRequests(id, [repo.ui.selectedBranch], { mode: 'full', silent: true })
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
        if (repo.ui.selectedBranch === branch && repo.ui.openCommit === null && repo.ui.openingCommitHash === null)
          return s
        changed = true
        token = repo.instanceToken
        return {
          repos: {
            ...s.repos,
            [id]: { ...repo, ui: { ...repo.ui, selectedBranch: branch, openCommit: null, openingCommitHash: null } },
          },
        }
      })
      const repo = get().repos[id]
      if (changed && token !== undefined) persistRepoCache(set, repo, token)
      if (changed && repo?.ui.detailTab === 'commits') void get().refreshBranchLog(id, branch)
      if (changed) void get().refreshPullRequests(id, [branch], { mode: 'full', silent: true })
    },

    selectLog(id: string, branch: string, hash: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const prev = repo.data.logsByBranch[branch] ?? { entries: [], selectedHash: null, loading: false }
        if (!prev.entries.some((entry) => entry.hash === hash) || prev.selectedHash === hash) return s
        return {
          repos: {
            ...s.repos,
            [id]: {
              ...repo,
              data: {
                ...repo.data,
                logsByBranch: { ...repo.data.logsByBranch, [branch]: { ...prev, selectedHash: hash } },
              },
            },
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
      try {
        const result = await rpc.repo.checkout.mutate({ cwd: id, branch })
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
