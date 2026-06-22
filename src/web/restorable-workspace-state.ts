import type { SessionState } from '#/shared/api-types.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import {
  persistedActiveRepoIdForSession,
  persistedWorkspacePaneTabOrderByBranchByRepoForSession,
  persistedSelectedTerminalByWorktreeForSession,
  persistedPreferredWorkspacePaneViewByBranchByRepoForSession,
} from '#/web/session-persistence-state.ts'

export function sessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
}): SessionState {
  const { repos, restorableWorkspaceState } = input
  return {
    openRepos: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, repos),
    activeRepo: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    workspaceFocused: restorableWorkspaceState.workspaceFocused,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalByWorktree: persistedSelectedTerminalByWorktreeForSession(
      restorableWorkspaceState.selectedTerminalByWorktree,
      repos,
    ),
    preferredWorkspacePaneViewByBranchByRepo: persistedPreferredWorkspacePaneViewByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
    ),
    workspacePaneTabOrderByBranchByRepo: persistedWorkspacePaneTabOrderByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
    ),
  }
}

/** Restores only the restorable workspace UI projection from SessionState.
 *  It intentionally does not establish a live binding back to SessionState;
 *  subsequent updates flow through useSessionPersistence. */
interface RestoredWorkspaceStateFromSession
  extends Pick<
    RestorableWorkspaceState,
    'activeId' | 'workspaceFocused' | 'workspacePaneSize' | 'selectedTerminalByWorktree'
  > {
  preferredWorkspacePaneViewByBranchByRepo: NonNullable<SessionState['preferredWorkspacePaneViewByBranchByRepo']>
  workspacePaneTabOrderByBranchByRepo: SessionState['workspacePaneTabOrderByBranchByRepo']
}

export function restoreRestorableWorkspaceStateFromSession(
  session: SessionState,
  activeId: string | null = session.activeRepo,
): RestoredWorkspaceStateFromSession {
  return {
    activeId,
    workspaceFocused: session.workspaceFocused,
    workspacePaneSize: session.workspacePaneSize,
    selectedTerminalByWorktree: session.selectedTerminalByWorktree ?? {},
    preferredWorkspacePaneViewByBranchByRepo: session.preferredWorkspacePaneViewByBranchByRepo ?? {},
    workspacePaneTabOrderByBranchByRepo: session.workspacePaneTabOrderByBranchByRepo ?? {},
  }
}
