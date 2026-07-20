import { appendRepoEvent, replaceWorkspaceState, resultEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoResultEventOptions, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'

export function createGitWorkspaceProjectionActions(set: WorkspacesSet) {
  return {
    setLastResult(id: string, result: ExecResult, workspaceRuntimeId: string, options?: RepoResultEventOptions) {
      set((state) => {
        const workspace = state.workspaces[id]
        if (!workspace || workspace.workspaceRuntimeId !== workspaceRuntimeId || !isGitWorkspace(workspace))
          return state
        return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
          if (!isGitWorkspace(nextWorkspace)) return
          const git = gitWorkspaceProjection(nextWorkspace)
          git.events = appendRepoEvent(git.events, resultEvent(result, options))
        })
      })
    },

    clearEvents(id: string, eventIds: number[]) {
      if (eventIds.length === 0) return
      const ids = new Set(eventIds)
      set((state) => {
        const workspace = state.workspaces[id]
        if (!workspace || !isGitWorkspace(workspace)) return state
        const events = gitWorkspaceProjection(workspace).events.filter((event) => !ids.has(event.id))
        if (events.length === gitWorkspaceProjection(workspace).events.length) return state
        return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
          if (!isGitWorkspace(nextWorkspace)) return
          gitWorkspaceProjection(nextWorkspace).events = events
        })
      })
    },

    clearFetchFailed(id: string, workspaceRuntimeId: string) {
      set((state) => {
        const workspace = state.workspaces[id]
        if (!workspace || workspace.workspaceRuntimeId !== workspaceRuntimeId || !isGitWorkspace(workspace))
          return state
        if (!gitWorkspaceProjection(workspace).remote.fetchFailed) return state
        return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
          if (!isGitWorkspace(nextWorkspace)) return
          const remote = gitWorkspaceProjection(nextWorkspace).remote
          remote.fetchFailed = false
          remote.fetchError = null
        })
      })
    },
  }
}
