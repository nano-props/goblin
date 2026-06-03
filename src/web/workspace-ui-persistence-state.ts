import type { SessionState } from '#/shared/rpc.ts'
import type { PersistableWorkspaceUiState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import { persistedActiveRepoIdForSession, persistedSelectedTerminalByWorktreeForSession } from '#/web/session-persistence-state.ts'

export function sessionStateFromPersistableWorkspaceUi(input: {
  routeRepoId: string | null | undefined
  repos: ReposStore['repos']
  persistableWorkspaceUiState: PersistableWorkspaceUiState
}): SessionState {
  const { routeRepoId, repos, persistableWorkspaceUiState } = input
  return {
    openRepos: persistedOpenWorkspaceEntries(persistableWorkspaceUiState.order, repos),
    activeRepo: persistedActiveRepoIdForSession(routeRepoId, persistableWorkspaceUiState.activeId, repos),
    detailCollapsed: persistableWorkspaceUiState.detailCollapsed,
    detailFocusMode: persistableWorkspaceUiState.detailFocusMode,
    workspaceLayout: persistableWorkspaceUiState.workspaceLayout,
    detailPaneSizes: persistableWorkspaceUiState.detailPaneSizes,
    selectedTerminalByWorktree: persistedSelectedTerminalByWorktreeForSession(
      persistableWorkspaceUiState.selectedTerminalByWorktree,
      repos,
    ),
  }
}

/** Restores only the persistable workspace UI projection from SessionState.
 *  It intentionally does not establish a live binding back to SessionState;
 *  subsequent updates flow through useSessionPersistence. */
export function restoreWorkspaceUiFromSession(
  session: SessionState,
  activeId: string | null = session.activeRepo,
): Pick<
  PersistableWorkspaceUiState,
  'activeId' | 'detailCollapsed' | 'detailFocusMode' | 'workspaceLayout' | 'detailPaneSizes' | 'selectedTerminalByWorktree'
> {
  return {
    activeId,
    detailCollapsed: session.detailCollapsed,
    detailFocusMode: session.detailFocusMode,
    workspaceLayout: session.workspaceLayout,
    detailPaneSizes: session.detailPaneSizes,
    selectedTerminalByWorktree: session.selectedTerminalByWorktree ?? {},
  }
}
