import { appendRepoEvent, replaceWorkspaceState, resultEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoResultEventOptions, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { gitWorkspaceClientState, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-client-state.ts'

export function createGitWorkspaceClientActions(set: WorkspacesSet) {
  return {
    setLastResult(id: string, result: ExecResult, workspaceRuntimeId: string, options?: RepoResultEventOptions) {
      set((state) => {
        const workspace = state.workspaces[id]
        if (!workspace || workspace.workspaceRuntimeId !== workspaceRuntimeId || !isGitWorkspace(workspace))
          return state
        return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
          if (!isGitWorkspace(nextWorkspace)) return
          const git = gitWorkspaceClientState(nextWorkspace)
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
        const events = gitWorkspaceClientState(workspace).events.filter((event) => !ids.has(event.id))
        if (events.length === gitWorkspaceClientState(workspace).events.length) return state
        return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
          if (!isGitWorkspace(nextWorkspace)) return
          gitWorkspaceClientState(nextWorkspace).events = events
        })
      })
    },
  }
}
