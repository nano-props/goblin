import type { SessionState } from '#/shared/rpc.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import {
  persistedActiveRepoIdForSession,
  persistedSelectedTerminalByWorktreeForSession,
  persistedDetailTabByRepoForSession,
} from '#/web/session-persistence-state.ts'

export function sessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
}): SessionState {
  const { repos, restorableWorkspaceState } = input
  return {
    openRepos: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, repos),
    activeRepo: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    detailCollapsed: restorableWorkspaceState.detailCollapsed,
    detailFocusMode: restorableWorkspaceState.detailFocusMode,
    workspaceLayout: restorableWorkspaceState.workspaceLayout,
    detailPaneSizes: restorableWorkspaceState.detailPaneSizes,
    selectedTerminalByWorktree: persistedSelectedTerminalByWorktreeForSession(
      restorableWorkspaceState.selectedTerminalByWorktree,
      repos,
    ),
    detailTabByRepo: persistedDetailTabByRepoForSession(repos, restorableWorkspaceState.order),
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
  | 'detailCollapsed'
  | 'detailFocusMode'
  | 'workspaceLayout'
  | 'detailPaneSizes'
  | 'selectedTerminalByWorktree'
  | 'detailTabByRepo'
> {
  return {
    activeId,
    detailCollapsed: session.detailCollapsed,
    detailFocusMode: session.detailFocusMode,
    workspaceLayout: session.workspaceLayout,
    detailPaneSizes: session.detailPaneSizes,
    selectedTerminalByWorktree: session.selectedTerminalByWorktree ?? {},
    detailTabByRepo: session.detailTabByRepo ?? {},
  }
}
