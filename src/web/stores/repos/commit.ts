import { appendRepoEvent, replaceRepoState, resultEvent } from '#/web/stores/repos/repo-state-factory.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoResultEventOptions, ReposSet } from '#/web/stores/repos/types.ts'
export function createCommitActions(set: ReposSet) {
  return {
    setLastResult(id: string, result: ExecResult, repoRuntimeId: string, options?: RepoResultEventOptions) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.repoRuntimeId !== repoRuntimeId) return s
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

    clearFetchFailed(id: string, repoRuntimeId: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.repoRuntimeId !== repoRuntimeId) return s
        if (!repo.remote.fetchFailed) return s
        return replaceRepoState(s, repo, (r) => {
          r.remote.fetchFailed = false
          r.remote.fetchError = null
        })
      })
    },
  }
}
