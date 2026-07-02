import { appendRepoEvent, replaceRepoState, resultEvent } from '#/web/stores/repos/repo-state-factory.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoResultEventOptions, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
export function createCommitActions(set: ReposSet, get: ReposGet) {
  return {
    setLastResult(id: string, result: ExecResult, repoInstanceId: string, options?: RepoResultEventOptions) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.instanceId !== repoInstanceId) return s
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

    clearFetchFailed(id: string, repoInstanceId: string) {
      set((s) => {
        const repo = s.repos[id]
        if (!repo || repo.instanceId !== repoInstanceId) return s
        if (!repo.remote.fetchFailed) return s
        return replaceRepoState(s, repo, (r) => {
          r.remote.fetchFailed = false
          r.remote.fetchError = null
        })
      })
    },
  }
}
