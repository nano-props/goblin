import { appendRepoEvent, replaceWorkspaceState, resultEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoResultEventOptions, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
export function createCommitActions(set: WorkspacesSet) {
  return {
    setLastResult(id: string, result: ExecResult, workspaceRuntimeId: string, options?: RepoResultEventOptions) {
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId || !isGitWorkspace(repo)) return s
        return replaceWorkspaceState(s, repo, (r) => {
          if (!isGitWorkspace(r)) return
          const git = gitWorkspaceProjection(r)
          git.events = appendRepoEvent(git.events, resultEvent(result, options))
        })
      })
    },

    clearEvents(id: string, eventIds: number[]) {
      if (eventIds.length === 0) return
      const ids = new Set(eventIds)
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || !isGitWorkspace(repo)) return s
        const events = gitWorkspaceProjection(repo).events.filter((event) => !ids.has(event.id))
        if (events.length === gitWorkspaceProjection(repo).events.length) return s
        return replaceWorkspaceState(s, repo, (r) => {
          if (!isGitWorkspace(r)) return
          gitWorkspaceProjection(r).events = events
        })
      })
    },

    clearFetchFailed(id: string, workspaceRuntimeId: string) {
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || repo.workspaceRuntimeId !== workspaceRuntimeId || !isGitWorkspace(repo)) return s
        if (!gitWorkspaceProjection(repo).remote.fetchFailed) return s
        return replaceWorkspaceState(s, repo, (r) => {
          if (!isGitWorkspace(r)) return
          const remote = gitWorkspaceProjection(r).remote
          remote.fetchFailed = false
          remote.fetchError = null
        })
      })
    },
  }
}
