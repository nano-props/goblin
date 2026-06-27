import type { WorkspaceSessionState } from '#/shared/api-types.ts'
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
}): WorkspaceSessionState {
  const { repos, restorableWorkspaceState } = input
  return {
    openRepoEntries: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, repos),
    activeRepoId: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalSessionByWorktree: persistedSelectedTerminalByWorktreeForSession(
      restorableWorkspaceState.selectedTerminalSessionByWorktree,
      repos,
    ),
    preferredWorkspacePaneTabByBranchByRepo: persistedPreferredWorkspacePaneViewByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
    ),
    workspacePaneTabOrderByBranchByRepo: persistedWorkspacePaneTabOrderByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
    ),
  }
}

/** Restores only the restorable workspace UI projection from WorkspaceSessionState.
 *  It intentionally does not establish a live binding back to WorkspaceSessionState;
 *  subsequent updates flow through useSessionPersistence. */
interface RestoredWorkspaceStateFromSession extends Pick<
  RestorableWorkspaceState,
  'activeId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionByWorktree'
> {
  preferredWorkspacePaneTabByBranchByRepo: NonNullable<WorkspaceSessionState['preferredWorkspacePaneTabByBranchByRepo']>
  workspacePaneTabOrderByBranchByRepo: WorkspaceSessionState['workspacePaneTabOrderByBranchByRepo']
}

export function restoreRestorableWorkspaceStateFromSession(
  session: WorkspaceSessionState,
  activeId: string | null = session.activeRepoId,
): RestoredWorkspaceStateFromSession {
  return {
    activeId,
    zenMode: session.zenMode,
    workspacePaneSize: session.workspacePaneSize,
    selectedTerminalSessionByWorktree: session.selectedTerminalSessionByWorktree ?? {},
    preferredWorkspacePaneTabByBranchByRepo: session.preferredWorkspacePaneTabByBranchByRepo ?? {},
    workspacePaneTabOrderByBranchByRepo: session.workspacePaneTabOrderByBranchByRepo ?? {},
  }
}
