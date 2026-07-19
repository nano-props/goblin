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
import { parseTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import type { RestorableWorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import { persistedFiletreeViewStateByWorktreeByWorkspaceForSession } from '#/web/filetree-session-state.ts'
import type { FiletreeInteractionSnapshot } from '#/web/stores/workspaces/filetree-interaction-state.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  workspacePaneTabsByTargetFromQueryData,
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import {
  defaultWorkspacePaneTabs,
  workspacePaneStaticTabsFromEntries,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface ClientWorkspaceRestorationProjection {
  id: WorkspaceId
  ui: Pick<WorkspacesStore['workspaces'][string]['ui'], 'preferredWorkspacePaneTabByTarget'>
  gitTargets?: ClientWorkspaceGitTargets
}

interface ClientWorkspaceBranchProjection {
  name: string
  worktree?: { path?: string } | undefined
}

interface ClientWorkspaceGitTargets {
  branches: readonly ClientWorkspaceBranchProjection[]
}

interface ClientWorkspaceTargetProjection {
  gitTargets?: ClientWorkspaceGitTargets
  ui?: {
    preferredWorkspacePaneTabByTarget: Record<string, WorkspacePaneTabType | null>
  }
}

type ClientWorkspaceRestorationProjectionMap = Record<string, ClientWorkspaceRestorationProjection | undefined>

export function clientWorkspaceStateFromRestorableWorkspaceState(input: {
  workspaces: WorkspacesStore['workspaces']
  restorableWorkspaceState: RestorableWorkspaceState
  filetreeInteractionByScope?: Readonly<Record<string, FiletreeInteractionSnapshot>>
  restoredClientWorkspaceBaseline?: ClientWorkspaceState | null
}): ClientWorkspaceState {
  const { workspaces, restorableWorkspaceState } = input
  // Workspace membership is shell state: it must remain restorable even
  // while capability data queries are unavailable. Target-scoped state below
  // is different; it references branch/worktree identities and is only
  // persisted for workspaces whose branch read model can validate those targets.
  const restorationProjections = clientWorkspaceRestorationProjections(
    workspaces,
    restorableWorkspaceState.workspaceOrder,
  )
  const workspacePaneTabsByTargetByWorkspace = workspacePaneTabsByTargetByWorkspaceFromQueryCache(
    workspaces,
    restorableWorkspaceState.workspaceOrder,
  )
  const clientWorkspace: ClientWorkspaceState = {
    restoredWorkspaceId: restorableWorkspaceState.restoredWorkspaceId,
    zenMode: restorableWorkspaceState.zenMode,
    workspacePaneSize: restorableWorkspaceState.workspacePaneSize,
    selectedTerminalSessionIdByTerminalFilesystemTarget: selectedTerminalSessionsForClientWorkspace(
      restorableWorkspaceState.selectedTerminalSessionIdByTerminalFilesystemTarget,
      restorationProjections,
    ),
    preferredWorkspacePaneTabByTargetByWorkspace: preferredWorkspacePaneTabsForClientWorkspace(
      restorationProjections,
      restorableWorkspaceState.workspaceOrder,
      workspacePaneTabsByTargetByWorkspace,
    ),
    filetreeViewStateByWorktreeByWorkspace: persistedFiletreeViewStateByWorktreeByWorkspaceForSession(
      input.filetreeInteractionByScope ?? {},
      restorationProjections,
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

function clientWorkspaceRestorationProjections(
  workspaces: WorkspacesStore['workspaces'],
  workspaceOrder: readonly WorkspaceId[],
): ClientWorkspaceRestorationProjectionMap {
  const projections: ClientWorkspaceRestorationProjectionMap = {}
  for (const id of workspaceOrder) {
    const workspace = workspaces[id]
    if (!workspace) continue
    if (workspace.session.projectionState === 'stub') continue
    const branchModel = workspace.capability.kind === 'git' ? readRepoBranchSnapshotQueryProjection(workspace) : null
    const readyWithoutGit = workspace.capability.kind === 'filesystem'
    if (!branchModel && !readyWithoutGit) continue
    projections[id] = {
      id: workspace.id,
      ui: {
        preferredWorkspacePaneTabByTarget: workspace.ui.preferredWorkspacePaneTabByTarget,
      },
      ...(branchModel ? { gitTargets: { branches: branchModel.branches } } : {}),
    }
  }
  return projections
}

function workspacePaneTabsByTargetByWorkspaceFromQueryCache(
  workspaces: Record<string, Pick<WorkspacesStore['workspaces'][string], 'workspaceRuntimeId' | 'session'> | undefined>,
  workspaceOrder: readonly WorkspaceId[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byWorkspace: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of workspaceOrder) {
    const workspace = workspaces[id]
    if (!workspace) continue
    if (workspace.session.projectionState === 'stub') continue
    const data = primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(
      workspacePaneTabsQueryKey(id, workspace.workspaceRuntimeId),
    )
    if (!data) continue
    const byTarget = workspacePaneTabsByTargetFromQueryData(data)
    if (Object.keys(byTarget).length > 0) byWorkspace[id] = byTarget
  }
  return byWorkspace
}

function clientWorkspaceWithStubBaseline(
  clientWorkspace: ClientWorkspaceState,
  baseline: ClientWorkspaceState | null | undefined,
  workspaces: WorkspacesStore['workspaces'],
  workspaceOrder: readonly WorkspaceId[],
): ClientWorkspaceState {
  if (!baseline) return clientWorkspace
  const stubWorkspaceIds = new Set(workspaceOrder.filter((id) => workspaces[id]?.session.projectionState === 'stub'))
  if (stubWorkspaceIds.size === 0) return clientWorkspace
  return {
    ...clientWorkspace,
    selectedTerminalSessionIdByTerminalFilesystemTarget: mergeBaselineSelectedTerminals(
      clientWorkspace.selectedTerminalSessionIdByTerminalFilesystemTarget,
      baseline.selectedTerminalSessionIdByTerminalFilesystemTarget,
      stubWorkspaceIds,
    ),
    preferredWorkspacePaneTabByTargetByWorkspace: mergeBaselineWorkspaceMap(
      clientWorkspace.preferredWorkspacePaneTabByTargetByWorkspace,
      baseline.preferredWorkspacePaneTabByTargetByWorkspace,
      stubWorkspaceIds,
    ),
    filetreeViewStateByWorktreeByWorkspace: mergeBaselineWorkspaceMap(
      clientWorkspace.filetreeViewStateByWorktreeByWorkspace,
      baseline.filetreeViewStateByWorktreeByWorkspace,
      stubWorkspaceIds,
    ),
  }
}

function mergeBaselineWorkspaceMap<T>(
  current: Record<string, T>,
  baseline: Record<string, T>,
  stubWorkspaceIds: ReadonlySet<string>,
): Record<string, T> {
  let merged = current
  for (const workspaceId of stubWorkspaceIds) {
    const value = baseline[workspaceId]
    if (value === undefined) continue
    if (merged === current) merged = { ...current }
    merged[workspaceId] = value
  }
  return merged
}

function mergeBaselineSelectedTerminals(
  current: Record<string, string>,
  baseline: Record<string, string>,
  stubWorkspaceIds: ReadonlySet<string>,
): Record<string, string> {
  let merged = current
  for (const [terminalFilesystemTargetKey, terminalSessionId] of Object.entries(baseline)) {
    const workspaceId = parseTerminalFilesystemTargetKey(terminalFilesystemTargetKey)?.workspaceId
    if (!workspaceId || !stubWorkspaceIds.has(workspaceId)) continue
    if (merged === current) merged = { ...current }
    merged[terminalFilesystemTargetKey] = terminalSessionId
  }
  return merged
}

function preferredWorkspacePaneTabsForClientWorkspace(
  workspaces: Record<
    string,
    (ClientWorkspaceTargetProjection & Required<Pick<ClientWorkspaceTargetProjection, 'ui'>>) | undefined
  >,
  workspaceOrder: readonly WorkspaceId[],
  workspacePaneTabsByTargetByWorkspace: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Record<string, Record<string, WorkspacePaneSessionTabType | null>> {
  const byWorkspace: Record<string, Record<string, WorkspacePaneSessionTabType | null>> = {}
  for (const id of workspaceOrder) {
    const workspace = workspaces[id]
    if (!workspace) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType | null> = {}
    for (const [targetKey, tab] of Object.entries(workspace.ui.preferredWorkspacePaneTabByTarget)) {
      const target = workspacePaneTabsTargetKeyBelongsToWorkspace(targetKey, id, workspace)
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
    if (Object.keys(byTarget).length > 0) byWorkspace[id] = byTarget
  }
  return byWorkspace
}

export function restoredPreferredWorkspacePaneTabByTarget(
  workspaceId: WorkspaceId,
  workspace: ClientWorkspaceTargetProjection,
  preferredByTarget: Record<string, WorkspacePaneSessionTabType | null> | undefined,
  workspacePaneTabsByTarget: Record<string, WorkspacePaneTabEntry[]>,
): Record<string, WorkspacePaneSessionTabType | null> {
  if (!preferredByTarget) return {}
  return (
    preferredWorkspacePaneTabsForClientWorkspace(
      { [workspaceId]: { ...workspace, ui: { preferredWorkspacePaneTabByTarget: preferredByTarget } } },
      [workspaceId],
      { [workspaceId]: workspacePaneTabsByTarget },
    )[workspaceId] ?? {}
  )
}

function workspacePaneTabsTargetKeyBelongsToWorkspace(
  targetKey: string,
  workspaceId: WorkspaceId,
  workspace: ClientWorkspaceTargetProjection,
) {
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.workspaceId !== workspaceId) return null
  if (target.kind === 'workspace-root') return target
  if (target.kind === 'branch') {
    return workspace.gitTargets?.branches.some((branch) => branch.name === target.branchName) ? target : null
  }
  const worktreePath = parseCanonicalWorkspaceLocator(target.worktreeId)?.path
  return worktreePath && workspace.gitTargets?.branches.some((branch) => branch.worktree?.path === worktreePath)
    ? target
    : null
}

function selectedTerminalSessionsForClientWorkspace(
  selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>,
  workspaces: Record<string, ClientWorkspaceTargetProjection | undefined>,
): Record<string, string> {
  const persisted: Record<string, string> = {}
  for (const [terminalFilesystemTargetKey, terminalSessionId] of Object.entries(
    selectedTerminalSessionIdByTerminalFilesystemTarget,
  )) {
    const parsed = parseTerminalFilesystemTargetKey(terminalFilesystemTargetKey)
    if (!parsed || !terminalSessionId) continue
    const workspace = workspaces[parsed.workspaceId]
    if (!workspace) continue
    if (parsed.executionRootId === parsed.workspaceId) {
      persisted[terminalFilesystemTargetKey] = terminalSessionId
      continue
    }
    const worktreePath = parseCanonicalWorkspaceLocator(parsed.executionRootId)?.path
    if (!worktreePath) continue
    if (!workspace.gitTargets?.branches.some((branch) => branch.worktree?.path === worktreePath)) continue
    persisted[terminalFilesystemTargetKey] = terminalSessionId
  }
  return persisted
}

/** Restores only the restorable workspace UI projection from ClientWorkspaceState.
 *  It intentionally does not establish a live binding back to ClientWorkspaceState;
 *  subsequent local updates flow through useClientWorkspacePersistence. */
interface RestoredWorkspaceStateFromClientWorkspace extends Pick<
  RestorableWorkspaceState,
  'restoredWorkspaceId' | 'zenMode' | 'workspacePaneSize' | 'selectedTerminalSessionIdByTerminalFilesystemTarget'
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
    selectedTerminalSessionIdByTerminalFilesystemTarget:
      clientWorkspace.selectedTerminalSessionIdByTerminalFilesystemTarget,
    preferredWorkspacePaneTabByTargetByWorkspace: clientWorkspace.preferredWorkspacePaneTabByTargetByWorkspace,
  }
}
