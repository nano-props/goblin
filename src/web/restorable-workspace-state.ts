import type { WorkspaceSessionState } from '#/shared/api-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedOpenWorkspaceEntries } from '#/web/open-workspace-state.ts'
import {
  persistedActiveRepoIdForSession,
  persistedWorkspacePaneTabsByTargetByRepoForSession,
  persistedSelectedTerminalSessionIdByTerminalWorktreeForSession,
  persistedPreferredWorkspacePaneTabByTargetByRepoForSession,
} from '#/web/session-persistence-state.ts'
import { persistedFiletreeViewStateByWorktreeByRepoForSession } from '#/web/filetree-session-state.ts'
import type { FiletreeInteractionSnapshot } from '#/web/stores/repos/filetree-interaction-state.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  workspacePaneTabsByTargetFromQueryData,
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function workspaceSessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
}): WorkspaceSessionState {
  const { repos, restorableWorkspaceState } = input
  const workspacePaneTabsByTargetByRepo = workspacePaneTabsByTargetByRepoFromQueryCache(
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
    preferredWorkspacePaneTabByTargetByRepo: persistedPreferredWorkspacePaneTabByTargetByRepoForSession(
      repos,
      restorableWorkspaceState.order,
      workspacePaneTabsByTargetByRepo,
    ),
    workspacePaneTabsByTargetByRepo: persistedWorkspacePaneTabsByTargetByRepoForSession(
      repos,
      restorableWorkspaceState.order,
      workspacePaneTabsByTargetByRepo,
    ),
    filetreeViewStateByWorktreeByRepo: persistedFiletreeViewStateByWorktreeByRepoForSession(
      input.filetreeInteractionByScope ?? {},
      repos,
      restorableWorkspaceState.order,
    ),
  }
}

function workspacePaneTabsByTargetByRepoFromQueryCache(
  repos: ReposStore['repos'],
  order: readonly string[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of order) {
    if (!repos[id]) continue
    const data = primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(id))
    if (!data) continue
    const byTarget = workspacePaneTabsByTargetFromQueryData(data)
    if (Object.keys(byTarget).length > 0) byRepo[id] = byTarget
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
  preferredWorkspacePaneTabByTargetByRepo: WorkspaceSessionState['preferredWorkspacePaneTabByTargetByRepo']
  workspacePaneTabsByTargetByRepo: WorkspaceSessionState['workspacePaneTabsByTargetByRepo']
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
    preferredWorkspacePaneTabByTargetByRepo: session.preferredWorkspacePaneTabByTargetByRepo,
    workspacePaneTabsByTargetByRepo: session.workspacePaneTabsByTargetByRepo,
  }
}
