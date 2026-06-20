import type { SessionState } from '#/shared/api-types.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import {
  persistedActiveRepoIdForSession,
  persistedSelectedTerminalByWorktreeForSession,
  persistedWorkspacePaneViewByRepoForSession,
} from '#/web/session-persistence-state.ts'

export function sessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
}): SessionState {
  const { repos, restorableWorkspaceState } = input
  return {
    openRepos: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, repos),
    activeRepo: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    branchListPaneVisible: restorableWorkspaceState.branchListPaneVisible,
    workspacePaneSizes: restorableWorkspaceState.workspacePaneSizes,
    selectedTerminalByWorktree: persistedSelectedTerminalByWorktreeForSession(
      restorableWorkspaceState.selectedTerminalByWorktree,
      repos,
    ),
    workspacePaneViewByRepo: persistedWorkspacePaneViewByRepoForSession(repos, restorableWorkspaceState.order),
  }
}

/** Restores only the restorable workspace UI projection from SessionState.
 *  It intentionally does not establish a live binding back to SessionState;
 *  subsequent updates flow through useSessionPersistence. */
export function restoreRestorableWorkspaceStateFromSession(
  session: SessionState,
  activeId: string | null = session.activeRepo,
): Pick<
  RestorableWorkspaceState,
  | 'activeId'
  | 'branchListPaneVisible'
  | 'workspacePaneSizes'
  | 'selectedTerminalByWorktree'
  | 'workspacePaneViewByRepo'
> {
  return {
    activeId,
    branchListPaneVisible: session.branchListPaneVisible,
    workspacePaneSizes: session.workspacePaneSizes,
    selectedTerminalByWorktree: session.selectedTerminalByWorktree ?? {},
    workspacePaneViewByRepo: session.workspacePaneViewByRepo ?? {},
  }
}
