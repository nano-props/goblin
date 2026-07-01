import type { WorkspaceSessionState } from '#/shared/api-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import {
  persistedActiveRepoIdForSession,
  persistedWorkspacePaneTabsByBranchByRepoForSession,
  persistedSelectedTerminalSessionIdByTerminalWorktreeForSession,
  persistedPreferredWorkspacePaneTabByBranchByRepoForSession,
} from '#/web/session-persistence-state.ts'
import { persistedFiletreeViewStateByWorktreeByRepoForSession } from '#/web/filetree-session-state.ts'
import type { FiletreeInteractionSnapshot } from '#/web/stores/repos/filetree-interaction-state.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  workspacePaneTabsByBranchFromQueryData,
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function workspaceSessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
}): WorkspaceSessionState {
  const { repos, restorableWorkspaceState } = input
  const workspacePaneTabsByBranchByRepo = workspacePaneTabsByBranchByRepoFromQueryCache(
    repos,
    restorableWorkspaceState.order,
  )
  return {
    openRepoEntries: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, repos),
    activeRepoId: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: persistedSelectedTerminalSessionIdByTerminalWorktreeForSession(
      restorableWorkspaceState.selectedTerminalSessionIdByTerminalWorktree,
      repos,
    ),
    preferredWorkspacePaneTabByBranchByRepo: persistedPreferredWorkspacePaneTabByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
      workspacePaneTabsByBranchByRepo,
    ),
    workspacePaneTabsByBranchByRepo: persistedWorkspacePaneTabsByBranchByRepoForSession(
      repos,
      restorableWorkspaceState.order,
      workspacePaneTabsByBranchByRepo,
    ),
    filetreeViewStateByWorktreeByRepo: persistedFiletreeViewStateByWorktreeByRepoForSession(
      input.filetreeInteractionByScope ?? {},
      repos,
      restorableWorkspaceState.order,
    ),
  }
}

function workspacePaneTabsByBranchByRepoFromQueryCache(
  repos: ReposStore['repos'],
  order: readonly string[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of order) {
    if (!repos[id]) continue
    const data = primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(id))
    if (!data) continue
    const byBranch = workspacePaneTabsByBranchFromQueryData(data)
    if (Object.keys(byBranch).length > 0) byRepo[id] = byBranch
  }
  return byRepo
}

/** Restores only the restorable workspace UI projection from WorkspaceSessionState.
 *  It intentionally does not establish a live binding back to WorkspaceSessionState;
 *  subsequent updates flow through useSessionPersistence. */
interface RestoredWorkspaceStateFromSession extends Pick<
  RestorableWorkspaceState,
  'activeId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionIdByTerminalWorktree'
> {
  preferredWorkspacePaneTabByBranchByRepo: WorkspaceSessionState['preferredWorkspacePaneTabByBranchByRepo']
  workspacePaneTabsByBranchByRepo: WorkspaceSessionState['workspacePaneTabsByBranchByRepo']
}

export function restoreRestorableWorkspaceStateFromSession(
  session: WorkspaceSessionState,
  activeId: string | null = session.activeRepoId,
): RestoredWorkspaceStateFromSession {
  return {
    activeId,
    zenMode: session.zenMode,
    workspacePaneSize: session.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: session.selectedTerminalSessionIdByTerminalWorktree,
    preferredWorkspacePaneTabByBranchByRepo: session.preferredWorkspacePaneTabByBranchByRepo,
    workspacePaneTabsByBranchByRepo: session.workspacePaneTabsByBranchByRepo,
  }
}
