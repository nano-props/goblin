import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import {
  persistedRestoredRepoIdForSession,
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
  restoredSessionBaseline?: ClientWorkspaceState | null
}): ClientWorkspaceState {
  const { repos, restorableWorkspaceState } = input
  // Workspace membership is shell state: it must remain restorable even
  // while repo data queries are unavailable. Target-scoped state below
  // is different; it references branch/worktree identities and is only
  // persisted for repos whose branch read model can validate those targets.
  const projectedRepos = workspaceSessionRepoProjections(repos, restorableWorkspaceState.order)
  const workspacePaneTabsByTargetByRepo = workspacePaneTabsByTargetByRepoFromQueryCache(
    repos,
    restorableWorkspaceState.order,
  )
  const session: ClientWorkspaceState = {
    restoredRepoId: persistedRestoredRepoIdForSession(restorableWorkspaceState.restoredRepoId),
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
    filetreeViewStateByWorktreeByRepo: persistedFiletreeViewStateByWorktreeByRepoForSession(
      input.filetreeInteractionByScope ?? {},
      projectedRepos,
      restorableWorkspaceState.order,
    ),
  }
  return sessionWithStubBaseline(session, input.restoredSessionBaseline, repos, restorableWorkspaceState.order)
}

function workspaceSessionRepoProjections(
  repos: ReposStore['repos'],
  order: readonly string[],
): WorkspaceSessionRepoProjectionMap {
  const projectedRepos: WorkspaceSessionRepoProjectionMap = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    if (repo.session.projectionState === 'stub') continue
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

function workspacePaneTabsByTargetByRepoFromQueryCache(
  repos: Record<string, Pick<ReposStore['repos'][string], 'repoRuntimeId' | 'session'> | undefined>,
  order: readonly string[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    if (repo.session.projectionState === 'stub') continue
    const data = primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(
      workspacePaneTabsQueryKey(id, repo.repoRuntimeId),
    )
    if (!data) continue
    const byTarget = workspacePaneTabsByTargetFromQueryData(data)
    if (Object.keys(byTarget).length > 0) byRepo[id] = byTarget
  }
  return byRepo
}

function sessionWithStubBaseline(
  session: ClientWorkspaceState,
  baseline: ClientWorkspaceState | null | undefined,
  repos: ReposStore['repos'],
  order: readonly string[],
): ClientWorkspaceState {
  if (!baseline) return session
  const stubRepoIds = new Set(order.filter((id) => repos[id]?.session.projectionState === 'stub'))
  if (stubRepoIds.size === 0) return session
  return {
    ...session,
    selectedTerminalSessionIdByTerminalWorktree: mergeBaselineSelectedTerminals(
      session.selectedTerminalSessionIdByTerminalWorktree,
      baseline.selectedTerminalSessionIdByTerminalWorktree,
      stubRepoIds,
    ),
    preferredWorkspacePaneTabByTargetByRepo: mergeBaselineRepoMap(
      session.preferredWorkspacePaneTabByTargetByRepo,
      baseline.preferredWorkspacePaneTabByTargetByRepo,
      stubRepoIds,
    ),
    filetreeViewStateByWorktreeByRepo: mergeBaselineRepoMap(
      session.filetreeViewStateByWorktreeByRepo,
      baseline.filetreeViewStateByWorktreeByRepo,
      stubRepoIds,
    ),
  }
}

function mergeBaselineRepoMap<T>(
  current: Record<string, T>,
  baseline: Record<string, T>,
  stubRepoIds: ReadonlySet<string>,
): Record<string, T> {
  let merged = current
  for (const repoId of stubRepoIds) {
    const value = baseline[repoId]
    if (value === undefined) continue
    if (merged === current) merged = { ...current }
    merged[repoId] = value
  }
  return merged
}

function mergeBaselineSelectedTerminals(
  current: Record<string, string>,
  baseline: Record<string, string>,
  stubRepoIds: ReadonlySet<string>,
): Record<string, string> {
  let merged = current
  for (const [terminalWorktreeKey, terminalSessionId] of Object.entries(baseline)) {
    const repoId = repoIdFromTerminalWorktreeKey(terminalWorktreeKey)
    if (!repoId || !stubRepoIds.has(repoId)) continue
    if (merged === current) merged = { ...current }
    merged[terminalWorktreeKey] = terminalSessionId
  }
  return merged
}

function repoIdFromTerminalWorktreeKey(key: string): string | null {
  const index = key.indexOf('\0')
  if (index <= 0) return null
  return key.slice(0, index)
}

/** Restores only the restorable workspace UI projection from ClientWorkspaceState.
 *  It intentionally does not establish a live binding back to ClientWorkspaceState;
 *  subsequent local updates flow through useClientWorkspacePersistence. */
interface RestoredWorkspaceStateFromSession extends Pick<
  RestorableWorkspaceState,
  'restoredRepoId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionIdByTerminalWorktree'
> {
  preferredWorkspacePaneTabByTargetByRepo: ClientWorkspaceState['preferredWorkspacePaneTabByTargetByRepo']
}

export function restoreRestorableWorkspaceStateFromSession(
  session: ClientWorkspaceState,
  restoredRepoId: string | null = session.restoredRepoId,
): RestoredWorkspaceStateFromSession {
  return {
    restoredRepoId,
    zenMode: session.zenMode,
    workspacePaneSize: session.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: session.selectedTerminalSessionIdByTerminalWorktree,
    preferredWorkspacePaneTabByTargetByRepo: session.preferredWorkspacePaneTabByTargetByRepo,
  }
}
