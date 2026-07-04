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
import { readRepoBranchQueryProjection, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'

interface WorkspaceSessionRepoProjection {
  id: string
  remote: ReposStore['repos'][string]['remote']
  ui: Pick<ReposStore['repos'][string]['ui'], 'preferredWorkspacePaneTabByTarget'>
  branches: RepoBranchReadModelData['branches']
}

type WorkspaceSessionRepoProjectionMap = Record<string, WorkspaceSessionRepoProjection | undefined>

export function workspaceSessionStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
}): WorkspaceSessionState {
  const { repos, restorableWorkspaceState } = input
  // Workspace membership is shell state: it must remain restorable even
  // while repo data queries are unavailable. Target-scoped state below
  // is different; it references branch/worktree identities and is only
  // persisted for repos whose branch read model can validate those targets.
  const shellRepos = workspaceSessionRepoShells(repos, restorableWorkspaceState.order)
  const projectedRepos = workspaceSessionRepoProjections(repos, restorableWorkspaceState.order)
  const workspacePaneTabsByTargetByRepo = workspacePaneTabsByTargetByRepoFromQueryCache(
    repos,
    restorableWorkspaceState.order,
  )
  return {
    openRepoEntries: persistedOpenWorkspaceEntries(restorableWorkspaceState.order, shellRepos),
    activeRepoId: persistedActiveRepoIdForSession(restorableWorkspaceState.activeId),
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: persistedSelectedTerminalSessionIdByTerminalWorktreeForSession(
      restorableWorkspaceState.selectedTerminalSessionIdByTerminalWorktree,
      projectedRepos,
    ),
    preferredWorkspacePaneTabByTargetByRepo: persistedPreferredWorkspacePaneTabByTargetByRepoForSession(
      projectedRepos,
      restorableWorkspaceState.order,
      workspacePaneTabsByTargetByRepo,
    ),
    workspacePaneTabsByTargetByRepo: persistedWorkspacePaneTabsByTargetByRepoForSession(
      projectedRepos,
      restorableWorkspaceState.order,
      workspacePaneTabsByTargetByRepo,
    ),
    filetreeViewStateByWorktreeByRepo: persistedFiletreeViewStateByWorktreeByRepoForSession(
      input.filetreeInteractionByScope ?? {},
      projectedRepos,
      restorableWorkspaceState.order,
    ),
  }
}

function workspaceSessionRepoProjections(
  repos: ReposStore['repos'],
  order: readonly string[],
): WorkspaceSessionRepoProjectionMap {
  const projectedRepos: WorkspaceSessionRepoProjectionMap = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const branchModel = readRepoBranchQueryProjection(repo)
    if (!branchModel) continue
    projectedRepos[id] = {
      id: repo.id,
      remote: repo.remote,
      ui: {
        preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
      },
      branches: branchModel.branches,
    }
  }
  return projectedRepos
}

function workspaceSessionRepoShells(
  repos: ReposStore['repos'],
  order: readonly string[],
): Record<string, Pick<ReposStore['repos'][string], 'id' | 'remote'> | undefined> {
  const shells: Record<string, Pick<ReposStore['repos'][string], 'id' | 'remote'> | undefined> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    shells[id] = { id: repo.id, remote: repo.remote }
  }
  return shells
}

function workspacePaneTabsByTargetByRepoFromQueryCache(
  repos: Record<string, Pick<ReposStore['repos'][string], 'instanceId'> | undefined>,
  order: readonly string[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const data = primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(
      workspacePaneTabsQueryKey(id, repo.instanceId),
    )
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
