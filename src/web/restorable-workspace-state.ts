import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import {
  isWorkspacePaneSessionTabType,
  isWorkspacePaneStaticTabType,
  type WorkspacePaneSessionTabType,
  type WorkspacePaneTabEntry,
  type WorkspacePaneTabType,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import { parseWorkspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { RestorableWorkspaceState, ReposStore } from '#/web/stores/repos/types.ts'
import { persistedFiletreeViewStateByWorktreeByRepoForSession } from '#/web/filetree-session-state.ts'
import type { FiletreeInteractionSnapshot } from '#/web/stores/repos/filetree-interaction-state.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  workspacePaneTabsByTargetFromQueryData,
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchSnapshotQueryProjection, type RepoBranchSnapshotData } from '#/web/repo-branch-read-model.ts'
import {
  defaultWorkspacePaneTabs,
  workspacePaneStaticTabsFromEntries,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface ClientWorkspaceRepoProjection {
  id: string
  remote: ReposStore['repos'][string]['remote']
  ui: Pick<ReposStore['repos'][string]['ui'], 'preferredWorkspacePaneTabByTarget'>
  branches: RepoBranchSnapshotData['branches']
}

interface ClientWorkspaceBranchProjection {
  name: string
  worktree?: { path?: string } | undefined
}

interface ClientWorkspaceRepoTargetProjection {
  branches: readonly ClientWorkspaceBranchProjection[]
  ui?: {
    preferredWorkspacePaneTabByTarget: Record<string, WorkspacePaneTabType | null>
  }
}

type ClientWorkspaceRepoProjectionMap = Record<string, ClientWorkspaceRepoProjection | undefined>

export function clientWorkspaceStateFromRestorableWorkspaceState(input: {
  repos: ReposStore['repos']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
  restoredClientWorkspaceBaseline?: ClientWorkspaceState | null
}): ClientWorkspaceState {
  const { repos, restorableWorkspaceState } = input
  // Workspace membership is shell state: it must remain restorable even
  // while repo data queries are unavailable. Target-scoped state below
  // is different; it references branch/worktree identities and is only
  // persisted for repos whose branch read model can validate those targets.
  const projectedRepos = clientWorkspaceRepoProjections(repos, restorableWorkspaceState.order)
  const workspacePaneTabsByTargetByWorkspace = workspacePaneTabsByTargetByWorkspaceFromQueryCache(
    repos,
    restorableWorkspaceState.order,
  )
  const clientWorkspace: ClientWorkspaceState = {
    restoredRepoId: restorableWorkspaceState.restoredRepoId,
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: selectedTerminalSessionsForClientWorkspace(
      restorableWorkspaceState.selectedTerminalSessionIdByTerminalWorktree,
      projectedRepos,
    ),
    preferredWorkspacePaneTabByTargetByRepo: preferredWorkspacePaneTabsForClientWorkspace(
      projectedRepos,
      restorableWorkspaceState.order,
      workspacePaneTabsByTargetByWorkspace,
    ),
    filetreeViewStateByWorktreeByRepo: persistedFiletreeViewStateByWorktreeByRepoForSession(
      input.filetreeInteractionByScope ?? {},
      projectedRepos,
      restorableWorkspaceState.order,
    ),
  }
  return clientWorkspaceWithStubBaseline(
    clientWorkspace,
    input.restoredClientWorkspaceBaseline,
    repos,
    restorableWorkspaceState.order,
  )
}

function clientWorkspaceRepoProjections(
  repos: ReposStore['repos'],
  order: readonly string[],
): ClientWorkspaceRepoProjectionMap {
  const projectedRepos: ClientWorkspaceRepoProjectionMap = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    if (repo.session.projectionState === 'stub') continue
    const branchModel = readRepoBranchSnapshotQueryProjection(repo)
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

function workspacePaneTabsByTargetByWorkspaceFromQueryCache(
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

function clientWorkspaceWithStubBaseline(
  clientWorkspace: ClientWorkspaceState,
  baseline: ClientWorkspaceState | null | undefined,
  repos: ReposStore['repos'],
  order: readonly string[],
): ClientWorkspaceState {
  if (!baseline) return clientWorkspace
  const stubRepoIds = new Set(order.filter((id) => repos[id]?.session.projectionState === 'stub'))
  if (stubRepoIds.size === 0) return clientWorkspace
  return {
    ...clientWorkspace,
    selectedTerminalSessionIdByTerminalWorktree: mergeBaselineSelectedTerminals(
      clientWorkspace.selectedTerminalSessionIdByTerminalWorktree,
      baseline.selectedTerminalSessionIdByTerminalWorktree,
      stubRepoIds,
    ),
    preferredWorkspacePaneTabByTargetByRepo: mergeBaselineRepoMap(
      clientWorkspace.preferredWorkspacePaneTabByTargetByRepo,
      baseline.preferredWorkspacePaneTabByTargetByRepo,
      stubRepoIds,
    ),
    filetreeViewStateByWorktreeByRepo: mergeBaselineRepoMap(
      clientWorkspace.filetreeViewStateByWorktreeByRepo,
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

function preferredWorkspacePaneTabsForClientWorkspace(
  repos: Record<
    string,
    (ClientWorkspaceRepoTargetProjection & Required<Pick<ClientWorkspaceRepoTargetProjection, 'ui'>>) | undefined
  >,
  order: readonly string[],
  workspacePaneTabsByTargetByWorkspace: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Record<string, Record<string, WorkspacePaneSessionTabType | null>> {
  const byRepo: Record<string, Record<string, WorkspacePaneSessionTabType | null>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType | null> = {}
    for (const [targetKey, tab] of Object.entries(repo.ui.preferredWorkspacePaneTabByTarget)) {
      const target = workspacePaneTabsTargetKeyBelongsToRepo(targetKey, id, repo)
      if (!target) continue
      if (tab !== null && !isWorkspacePaneSessionTabType(tab)) continue
      if (tab !== null && target.kind === 'branch' && workspacePaneTabRequiresWorktree(tab)) continue
      const targetTabs = workspacePaneTabsByTargetByWorkspace[id]?.[targetKey] ?? defaultWorkspacePaneTabs()
      if (
        tab !== null &&
        isWorkspacePaneStaticTabType(tab) &&
        !workspacePaneStaticTabsFromEntries(targetTabs).includes(tab)
      )
        continue
      byTarget[targetKey] = tab
    }
    if (Object.keys(byTarget).length > 0) byRepo[id] = byTarget
  }
  return byRepo
}

export function restoredPreferredWorkspacePaneTabByTarget(
  repoRoot: string,
  repo: ClientWorkspaceRepoTargetProjection,
  preferredByTarget: Record<string, WorkspacePaneSessionTabType | null> | undefined,
  workspacePaneTabsByTarget: Record<string, WorkspacePaneTabEntry[]>,
): Record<string, WorkspacePaneSessionTabType | null> {
  if (!preferredByTarget) return {}
  return (
    preferredWorkspacePaneTabsForClientWorkspace(
      { [repoRoot]: { ...repo, ui: { preferredWorkspacePaneTabByTarget: preferredByTarget } } },
      [repoRoot],
      { [repoRoot]: workspacePaneTabsByTarget },
    )[repoRoot] ?? {}
  )
}

function workspacePaneTabsTargetKeyBelongsToRepo(
  targetKey: string,
  repoRoot: string,
  repo: ClientWorkspaceRepoTargetProjection,
) {
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.repoRoot !== repoRoot) return null
  if (target.kind === 'branch') {
    return repo.branches.some((branch) => branch.name === target.branchName) ? target : null
  }
  return repo.branches.some((branch) => branch.worktree?.path === target.worktreePath) ? target : null
}

function selectedTerminalSessionsForClientWorkspace(
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>,
  repos: Record<string, ClientWorkspaceRepoTargetProjection | undefined>,
): Record<string, string> {
  const persisted: Record<string, string> = {}
  for (const [terminalWorktreeKey, terminalSessionId] of Object.entries(selectedTerminalSessionIdByTerminalWorktree)) {
    const parts = terminalWorktreeKey.split('\0')
    if (parts.length !== 2) continue
    const [repoRoot, worktreePath] = parts
    if (!repoRoot || !worktreePath || !terminalSessionId) continue
    const repo = repos[repoRoot]
    if (!repo?.branches.some((branch) => branch.worktree?.path === worktreePath)) continue
    persisted[terminalWorktreeKey] = terminalSessionId
  }
  return persisted
}

/** Restores only the restorable workspace UI projection from ClientWorkspaceState.
 *  It intentionally does not establish a live binding back to ClientWorkspaceState;
 *  subsequent local updates flow through useClientWorkspacePersistence. */
interface RestoredWorkspaceStateFromClientWorkspace extends Pick<
  RestorableWorkspaceState,
  'restoredRepoId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionIdByTerminalWorktree'
> {
  preferredWorkspacePaneTabByTargetByRepo: ClientWorkspaceState['preferredWorkspacePaneTabByTargetByRepo']
}

export function restoreRestorableWorkspaceStateFromClientWorkspace(
  clientWorkspace: ClientWorkspaceState,
  restoredRepoId: string | null = clientWorkspace.restoredRepoId,
): RestoredWorkspaceStateFromClientWorkspace {
  return {
    restoredRepoId,
    zenMode: clientWorkspace.zenMode,
    workspacePaneSize: clientWorkspace.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: clientWorkspace.selectedTerminalSessionIdByTerminalWorktree,
    preferredWorkspacePaneTabByTargetByRepo: clientWorkspace.preferredWorkspacePaneTabByTargetByRepo,
  }
}
