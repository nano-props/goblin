import type { WorkspaceSessionState } from '#/shared/api-types.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import {
  persistedActiveRepoIdForSession,
  persistedWorkspacePaneTabOrderByBranchByRepoForSession,
  persistedSelectedTerminalKeyByWorktreeForSession,
  persistedPreferredWorkspacePaneTabByBranchByRepoForSession,
} from '#/web/session-persistence-state.ts'
import { persistedFiletreeViewStateByWorktreeByRepoForSession } from '#/web/filetree-session-state.ts'
import type { FiletreeInteractionSnapshot } from '#/web/stores/repos/filetree-interaction-state.ts'

export function workspaceSessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
}): WorkspaceSessionState {
  const { repos, restorableWorkspaceState } = input
  return {
    openRepoEntries: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, repos),
    activeRepoId: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalKeyByWorktree: persistedSelectedTerminalKeyByWorktreeForSession(
      restorableWorkspaceState.selectedTerminalKeyByWorktree,
      repos,
    ),
    preferredWorkspacePaneTabByBranchByRepo: persistedPreferredWorkspacePaneTabByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
    ),
    workspacePaneTabOrderByBranchByRepo: persistedWorkspacePaneTabOrderByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
    ),
    filetreeViewStateByWorktreeByRepo: persistedFiletreeViewStateByWorktreeByRepoForSession(
      input.filetreeInteractionByScope ?? {},
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
  'activeId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalKeyByWorktree'
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
    selectedTerminalKeyByWorktree: session.selectedTerminalKeyByWorktree ?? {},
    preferredWorkspacePaneTabByBranchByRepo: session.preferredWorkspacePaneTabByBranchByRepo ?? {},
    workspacePaneTabOrderByBranchByRepo: session.workspacePaneTabOrderByBranchByRepo ?? {},
  }
}
