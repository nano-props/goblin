import { arrayMove } from '@dnd-kit/sortable'
import type { ReposGet, ReposSet, RightTab } from '#/renderer/stores/repos/types.ts'

export function createSelectionActions(set: ReposSet, get: ReposGet) {
  return {
    setActive(id: string) {
      set((s) => (s.repos[id] ? { activeId: id } : s))
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
      const idx = activeId ? order.indexOf(activeId) : 0
      const nextIdx = (idx + direction + order.length) % order.length
      const next = order[nextIdx]
      if (next) set({ activeId: next })
    },

    setRightTab(id: string, tab: RightTab) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        return { repos: { ...s.repos, [id]: { ...repo, rightTab: tab, openCommit: null } } }
      })
      // Lazy-load tab content so the initial Branches view is fast.
      if (tab === 'log') void get().refreshLog(id)
      if (tab === 'status') void get().refreshStatus(id)
    },

    selectBranch(id: string, branch: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        // Branch change invalidates the Log cursor — the new branch's log
        // probably doesn't contain the old hash.
        return { repos: { ...s.repos, [id]: { ...repo, selectedBranch: branch, selectedLogHash: null } } }
      })
      // Refresh log against the new branch if the Log tab is showing.
      const repo = get().repos[id]
      if (repo?.rightTab === 'log') void get().refreshLog(id)
    },

    selectLog(id: string, hash: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        return { repos: { ...s.repos, [id]: { ...repo, selectedLogHash: hash } } }
      })
    },

    async checkoutSelected() {
      const state = get()
      const id = state.activeId
      if (!id) return
      const repo = state.repos[id]
      if (!repo || repo.rightTab !== 'branches') return
      const branch = repo.selectedBranch
      if (!branch || branch === repo.currentBranch) return
      const branchInfo = repo.branches.find((b) => b.name === branch)
      if (branchInfo?.worktreePath) return
      try {
        const result = await window.gbl.checkout(id, branch)
        get().setLastResult(id, result)
        await get().refreshSnapshot(id)
        await get().refreshStatus(id)
      } catch (err) {
        get().setLastResult(id, { ok: false, message: err instanceof Error ? err.message : String(err) })
      }
    },

    async openSelectedCommit() {
      const state = get()
      const id = state.activeId
      if (!id) return
      const repo = state.repos[id]
      if (!repo || repo.rightTab !== 'log') return
      const hash = repo.selectedLogHash ?? repo.log[0]?.hash
      if (!hash) return
      await get().openCommit(id, hash)
    },
  }
}
