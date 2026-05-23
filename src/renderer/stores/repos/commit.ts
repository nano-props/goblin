import { appendRepoEvent, errorEvent, resultEvent, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import type { ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import { rpc } from '#/renderer/rpc.ts'

export function createCommitActions(set: ReposSet, get: ReposGet) {
  return {
    async openCommit(id: string, hash: string) {
      const repoBefore = get().repos[id]
      if (!repoBefore) return
      const token = repoBefore.instanceToken
      updateIfFresh(set, id, token, (r) => {
        r.ui.openingCommitHash = hash
      })
      try {
        const detail = await rpc.repo.commit.query({ cwd: id, hash })
        updateIfFresh(set, id, token, (r) => {
          if (r.ui.openingCommitHash !== hash) return
          r.ui.openCommit = detail
          r.ui.openingCommitHash = null
        })
      } catch (err) {
        console.warn('[openCommit] failed', err)
        updateIfFresh(set, id, token, (r) => {
          if (r.ui.openingCommitHash !== hash) return
          r.ui.openingCommitHash = null
          r.events = appendRepoEvent(r.events, errorEvent(err instanceof Error ? err.message : String(err)))
        })
      }
    },

    closeCommit(id: string) {
      set((s) => {
        const cur = s.repos[id]
        if (!cur) return s
        return { repos: { ...s.repos, [id]: { ...cur, ui: { ...cur.ui, openCommit: null, openingCommitHash: null } } } }
      })
    },

    setLastResult(id: string, result: { ok: boolean; message: string }, token: number) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo) return s
        if (repo.instanceToken !== token) return s
        return { repos: { ...s.repos, [id]: { ...repo, events: appendRepoEvent(repo.events, resultEvent(result)) } } }
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
        if (!repo || !repo.remote.fetchFailed) return s
        if (repo.instanceToken !== token) return s
        return { repos: { ...s.repos, [id]: { ...repo, remote: { fetchFailed: false, fetchError: null } } } }
      })
    },
  }
}
