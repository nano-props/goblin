import { errorEvent, resultEvent, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'

export function createCommitActions(set: ReposSet, get: ReposGet) {
  return {
    async openCommit(id: string, hash: string) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = repoBefore.instanceToken
      updateIfFresh(set, id, token, (r) => ({ ...r, openingCommitHash: hash }))
      try {
        const detail = await window.gbl.commit(id, hash)
        updateIfFresh(set, id, token, (r) =>
          r.openingCommitHash === hash ? { ...r, openCommit: detail, openingCommitHash: null } : r,
        )
      } catch (err) {
        console.warn('[openCommit] failed', err)
        updateIfFresh(set, id, token, (r) =>
          r.openingCommitHash === hash
            ? {
                ...r,
                openingCommitHash: null,
                events: [...r.events, errorEvent(err instanceof Error ? err.message : String(err))],
              }
            : r,
        )
      }
    },

    closeCommit(id: string) {
      set((s) => {
        const cur = s.repos[id]
        if (!cur) return s
        return { repos: { ...s.repos, [id]: { ...cur, openCommit: null, openingCommitHash: null } } }
      })
    },

    setLastResult(id: string, result: { ok: boolean; message: string }, token: number) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (repo.instanceToken !== token) return s
        return { repos: { ...s.repos, [id]: { ...repo, events: [...repo.events, resultEvent(result)] } } }
      })
    },

    clearEvents(id: string, eventIds: number[]) {
      if (eventIds.length === 0) return
      const ids = new Set(eventIds)
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        const events = repo.events.filter((event) => !ids.has(event.id))
        if (events.length === repo.events.length) return s
        return { repos: { ...s.repos, [id]: { ...repo, events } } }
      })
    },

    clearFetchFailed(id: string, token: number) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || !repo.fetchFailed) return s
        if (repo.instanceToken !== token) return s
        return { repos: { ...s.repos, [id]: { ...repo, fetchFailed: false, fetchError: null } } }
      })
    },
  }
}
