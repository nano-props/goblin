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
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { parseTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { RestorableWorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import { persistedFiletreeViewStateByWorktreeByWorkspaceForSession } from '#/web/filetree-session-state.ts'
import type { FiletreeInteractionSnapshot } from '#/web/stores/workspaces/filetree-interaction-state.ts'
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
  ui: Pick<WorkspacesStore['workspaces'][string]['ui'], 'preferredWorkspacePaneTabByTarget'>
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
  workspaces: WorkspacesStore['workspaces']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
  restoredClientWorkspaceBaseline?: ClientWorkspaceState | null
}): ClientWorkspaceState {
  const { workspaces, restorableWorkspaceState } = input
  // Workspace membership is shell state: it must remain restorable even
  // while repo data queries are unavailable. Target-scoped state below
  // is different; it references branch/worktree identities and is only
  // persisted for workspaces whose branch read model can validate those targets.
  const projectedRepos = clientWorkspaceRepoProjections(workspaces, restorableWorkspaceState.workspaceOrder)
  const workspacePaneTabsByTargetByWorkspace = workspacePaneTabsByTargetByWorkspaceFromQueryCache(
    workspaces,
    restorableWorkspaceState.workspaceOrder,
  )
  const clientWorkspace: ClientWorkspaceState = {
    restoredWorkspaceId: restorableWorkspaceState.restoredWorkspaceId,
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: selectedTerminalSessionsForClientWorkspace(
      restorableWorkspaceState.selectedTerminalSessionIdByTerminalWorktree,
      projectedRepos,
    ),
    preferredWorkspacePaneTabByTargetByWorkspace: preferredWorkspacePaneTabsForClientWorkspace(
      projectedRepos,
      restorableWorkspaceState.workspaceOrder,
      workspacePaneTabsByTargetByWorkspace,
    ),
    filetreeViewStateByWorktreeByWorkspace: persistedFiletreeViewStateByWorktreeByWorkspaceForSession(
      input.filetreeInteractionByScope ?? {},
      projectedRepos,
      restorableWorkspaceState.workspaceOrder,
    ),
  }
  return clientWorkspaceWithStubBaseline(
    clientWorkspace,
    input.restoredClientWorkspaceBaseline,
    workspaces,
    restorableWorkspaceState.workspaceOrder,
  )
}

function clientWorkspaceRepoProjections(
  workspaces: WorkspacesStore['workspaces'],
  workspaceOrder: readonly string[],
): ClientWorkspaceRepoProjectionMap {
  const projectedRepos: ClientWorkspaceRepoProjectionMap = {}
  for (const id of workspaceOrder) {
    const repo = workspaces[id]
    if (!repo) continue
    if (repo.session.projectionState === 'stub') continue
    const branchModel = repo.capability.kind === 'git' ? readRepoBranchSnapshotQueryProjection(repo) : null
    const readyWithoutGit = repo.capability.kind === 'filesystem'
    if (!branchModel && !readyWithoutGit) continue
    projectedRepos[id] = {
      id: repo.id,
      ui: {
        preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
      },
      branches: branchModel?.branches ?? [],
    }
  }
  return projectedRepos
}

function workspacePaneTabsByTargetByWorkspaceFromQueryCache(
  workspaces: Record<string, Pick<WorkspacesStore['workspaces'][string], 'workspaceRuntimeId' | 'session'> | undefined>,
  workspaceOrder: readonly string[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of workspaceOrder) {
    const repo = workspaces[id]
    if (!repo) continue
    if (repo.session.projectionState === 'stub') continue
    const data = primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(
      workspacePaneTabsQueryKey(id, repo.workspaceRuntimeId),
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
  workspaces: WorkspacesStore['workspaces'],
  workspaceOrder: readonly string[],
): ClientWorkspaceState {
  if (!baseline) return clientWorkspace
  const stubRepoIds = new Set(workspaceOrder.filter((id) => workspaces[id]?.session.projectionState === 'stub'))
  if (stubRepoIds.size === 0) return clientWorkspace
  return {
    ...clientWorkspace,
    selectedTerminalSessionIdByTerminalWorktree: mergeBaselineSelectedTerminals(
      clientWorkspace.selectedTerminalSessionIdByTerminalWorktree,
      baseline.selectedTerminalSessionIdByTerminalWorktree,
      stubRepoIds,
    ),
    preferredWorkspacePaneTabByTargetByWorkspace: mergeBaselineRepoMap(
      clientWorkspace.preferredWorkspacePaneTabByTargetByWorkspace,
      baseline.preferredWorkspacePaneTabByTargetByWorkspace,
      stubRepoIds,
    ),
    filetreeViewStateByWorktreeByWorkspace: mergeBaselineRepoMap(
      clientWorkspace.filetreeViewStateByWorktreeByWorkspace,
      baseline.filetreeViewStateByWorktreeByWorkspace,
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
  workspaces: Record<
    string,
    (ClientWorkspaceRepoTargetProjection & Required<Pick<ClientWorkspaceRepoTargetProjection, 'ui'>>) | undefined
  >,
  workspaceOrder: readonly string[],
  workspacePaneTabsByTargetByWorkspace: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Record<string, Record<string, WorkspacePaneSessionTabType | null>> {
  const byRepo: Record<string, Record<string, WorkspacePaneSessionTabType | null>> = {}
  for (const id of workspaceOrder) {
    const repo = workspaces[id]
    if (!repo) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType | null> = {}
    for (const [targetKey, tab] of Object.entries(repo.ui.preferredWorkspacePaneTabByTarget)) {
      const target = workspacePaneTabsTargetKeyBelongsToRepo(targetKey, id, repo)
      if (!target) continue
      if (tab !== null && !isWorkspacePaneSessionTabType(tab)) continue
      if (tab !== null && target.kind === 'branch' && workspacePaneTabRequiresWorktree(tab)) continue
      const targetTabs =
        workspacePaneTabsByTargetByWorkspace[id]?.[targetKey] ??
        defaultWorkspacePaneTabs(target.kind === 'workspace-root' ? 'workspace-root' : 'git')
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
  workspaceId: string,
  repo: ClientWorkspaceRepoTargetProjection,
  preferredByTarget: Record<string, WorkspacePaneSessionTabType | null> | undefined,
  workspacePaneTabsByTarget: Record<string, WorkspacePaneTabEntry[]>,
): Record<string, WorkspacePaneSessionTabType | null> {
  if (!preferredByTarget) return {}
  return (
    preferredWorkspacePaneTabsForClientWorkspace(
      { [workspaceId]: { ...repo, ui: { preferredWorkspacePaneTabByTarget: preferredByTarget } } },
      [workspaceId],
      { [workspaceId]: workspacePaneTabsByTarget },
    )[workspaceId] ?? {}
  )
}

function workspacePaneTabsTargetKeyBelongsToRepo(
  targetKey: string,
  workspaceId: string,
  repo: ClientWorkspaceRepoTargetProjection,
) {
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.workspaceId !== workspaceId) return null
  if (target.kind === 'workspace-root') return target
  if (target.kind === 'branch') {
    return repo.branches.some((branch) => branch.name === target.branchName) ? target : null
  }
  const worktreePath = parseCanonicalWorkspaceLocator(target.worktreeId)?.path
  return worktreePath && repo.branches.some((branch) => branch.worktree?.path === worktreePath) ? target : null
}

function selectedTerminalSessionsForClientWorkspace(
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>,
  workspaces: Record<string, ClientWorkspaceRepoTargetProjection | undefined>,
): Record<string, string> {
  const persisted: Record<string, string> = {}
  for (const [terminalWorktreeKey, terminalSessionId] of Object.entries(selectedTerminalSessionIdByTerminalWorktree)) {
    const parsed = parseTerminalWorktreeKey(terminalWorktreeKey)
    if (!parsed || !terminalSessionId) continue
    const repo = workspaces[parsed.repoRoot]
    if (!repo) continue
    if (parsed.worktreeId === parsed.repoRoot) {
      persisted[terminalWorktreeKey] = terminalSessionId
      continue
    }
    const worktreePath = parseCanonicalWorkspaceLocator(parsed.worktreeId)?.path
    if (!worktreePath) continue
    if (!repo.branches.some((branch) => branch.worktree?.path === worktreePath)) continue
    persisted[terminalWorktreeKey] = terminalSessionId
  }
  return persisted
}

/** Restores only the restorable workspace UI projection from ClientWorkspaceState.
 *  It intentionally does not establish a live binding back to ClientWorkspaceState;
 *  subsequent local updates flow through useClientWorkspacePersistence. */
interface RestoredWorkspaceStateFromClientWorkspace extends Pick<
  RestorableWorkspaceState,
  'restoredWorkspaceId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionIdByTerminalWorktree'
> {
  preferredWorkspacePaneTabByTargetByWorkspace: ClientWorkspaceState['preferredWorkspacePaneTabByTargetByWorkspace']
}

export function restoreRestorableWorkspaceStateFromClientWorkspace(
  clientWorkspace: ClientWorkspaceState,
  restoredWorkspaceId: WorkspaceId | null = clientWorkspace.restoredWorkspaceId,
): RestoredWorkspaceStateFromClientWorkspace {
  return {
    restoredWorkspaceId,
    zenMode: clientWorkspace.zenMode,
    workspacePaneSize: clientWorkspace.workspacePaneSize,
    selectedTerminalSessionIdByTerminalWorktree: clientWorkspace.selectedTerminalSessionIdByTerminalWorktree,
    preferredWorkspacePaneTabByTargetByWorkspace: clientWorkspace.preferredWorkspacePaneTabByTargetByWorkspace,
  }
}
