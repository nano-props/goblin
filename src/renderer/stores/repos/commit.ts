import { updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'

export function createCommitActions(set: ReposSet, get: ReposGet) {
  return {
    async openCommit(id: string, hash: string) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = repoBefore.instanceToken
      try {
        const detail = await window.gbl.commit(id, hash)
        updateIfFresh(set, id, token, (r) => ({ ...r, openCommit: detail }))
      } catch (err) {
        console.warn('[openCommit] failed', err)
        updateIfFresh(set, id, token, (r) => ({
          ...r,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },

    closeCommit(id: string) {
      set((s) => {
        const cur = s.repos[id]
        if (!cur) return s
        return { repos: { ...s.repos, [id]: { ...cur, openCommit: null } } }
      })
    },

    setLastResult(id: string, result: { ok: boolean; message: string } | null) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        return { repos: { ...s.repos, [id]: { ...repo, lastResult: result } } }
      })
    },

    setError(id: string, error: string | null) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        return { repos: { ...s.repos, [id]: { ...repo, error } } }
      })
    },

    clearFetchFailed(id: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || !repo.fetchFailed) return s
        return { repos: { ...s.repos, [id]: { ...repo, fetchFailed: false, fetchError: null } } }
      })
    },
  }
}
