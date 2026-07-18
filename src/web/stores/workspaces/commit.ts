import { appendRepoEvent, replaceWorkspaceState, resultEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoResultEventOptions, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
export function createCommitActions(set: WorkspacesSet) {
  return {
    setLastResult(id: string, result: ExecResult, workspaceRuntimeId: string, options?: RepoResultEventOptions) {
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId) return s
        return replaceWorkspaceState(s, repo, (r) => {
          r.events = appendRepoEvent(r.events, resultEvent(result, options))
        })
      })
    },

    clearEvents(id: string, eventIds: number[]) {
      if (eventIds.length === 0) return
      const ids = new Set(eventIds)
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo) return s
        const events = repo.events.filter((event) => !ids.has(event.id))
        if (events.length === repo.events.length) return s
        return replaceWorkspaceState(s, repo, (r) => {
          r.events = events
        })
      })
    },

    clearFetchFailed(id: string, workspaceRuntimeId: string) {
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId) return s
        if (!repo.remote.fetchFailed) return s
        return replaceWorkspaceState(s, repo, (r) => {
          r.remote.fetchFailed = false
          r.remote.fetchError = null
        })
      })
    },
  }
}
