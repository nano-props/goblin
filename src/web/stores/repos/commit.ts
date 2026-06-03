import { appendRepoEvent, replaceRepoState, resultEvent } from '#/web/stores/repos/helpers.ts'
import type { RepoResultEventOptions, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
export function createCommitActions(set: ReposSet, get: ReposGet) {
  return {
    setLastResult(
      id: string,
      result: { ok: boolean; message: string },
      token: number,
      options?: RepoResultEventOptions,
    ) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.instanceToken !== token) return s
        return replaceRepoState(s, repo, (r) => {
          r.events = appendRepoEvent(r.events, resultEvent(result, options))
        })
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
        return replaceRepoState(s, repo, (r) => {
          r.events = events
        })
      })
    },

    clearFetchFailed(id: string, token: number) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.instanceToken !== token) return s
        if (!repo.remote.fetchFailed) return s
        return replaceRepoState(s, repo, (r) => {
          r.remote.fetchFailed = false
          r.remote.fetchError = null
        })
      })
    },
  }
}
