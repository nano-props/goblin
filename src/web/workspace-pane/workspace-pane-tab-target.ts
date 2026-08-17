import {
  createWorkspacePaneTabModel,
  workspacePaneTabModelBlocksTabInteraction,
  workspacePaneTabModelPaneTarget,
  workspacePaneTabModelWorkspaceRuntimeId,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import {
  preferredWorkspacePaneTabForTarget,
  type WorkspacePanePreferenceState,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { getRepoSnapshotQueryData } from '#/web/repos/query-cache.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneTabsInteractionBlockedForTarget } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  type FilesystemWorkspacePaneTabsTarget,
  type GitBranchWorkspacePaneTabsTarget,
  type GitWorktreeWorkspacePaneTabsTarget,
  type RootWorkspacePaneTabsTarget,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import {
  gitWorktreeFilesystemExecutionTarget,
  workspaceRootFilesystemExecutionTarget,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import {
  workspacePaneLocationForBranch,
  workspacePaneLocationBranchName,
  workspacePaneLocationExecutionTarget,
  workspacePaneLocationForWorktree,
  workspacePaneLocationWorktreePath,
  workspacePaneLocationForRoot,
  type WorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export interface WorkspaceRootPaneTargetLease {
  routeTarget: RootWorkspacePaneTabsTarget
  workspaceRuntimeId: string
}

export interface GitWorktreePaneTargetLease {
  routeTarget: GitWorktreeWorkspacePaneTabsTarget
  workspaceRuntimeId: string
}

export interface GitBranchPaneTargetLease {
  routeTarget: GitBranchWorkspacePaneTabsTarget
  workspaceRuntimeId: string
}

export type FilesystemWorkspacePaneTargetLease = WorkspaceRootPaneTargetLease | GitWorktreePaneTargetLease

export interface FilesystemWorkspacePaneTargetLeaseSource {
  location: WorkspacePaneLocation | null
}

export function filesystemWorkspacePaneTargetLeaseForModel(
  model: FilesystemWorkspacePaneTargetLeaseSource,
): FilesystemWorkspacePaneTargetLease | null {
  const location = model.location
  if (!location || location.kind === 'branch') return null
  return filesystemWorkspacePaneTargetLeaseForLocation(location)
}

export function filesystemWorkspacePaneTargetLeaseForLocation(
  location: Exclude<WorkspacePaneLocation, { kind: 'branch' }>,
): FilesystemWorkspacePaneTargetLease {
  if (location.kind === 'workspace-root') {
    return { routeTarget: location.routeTarget, workspaceRuntimeId: location.workspaceRuntimeId }
  }
  return { routeTarget: location.routeTarget, workspaceRuntimeId: location.workspaceRuntimeId }
}

export function workspaceRootPaneTargetLease(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): WorkspaceRootPaneTargetLease {
  return {
    routeTarget: { kind: 'workspace-root', workspaceId },
    workspaceRuntimeId,
  }
}

export function gitWorktreePaneTargetLease(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  worktreePath: string,
): GitWorktreePaneTargetLease {
  return {
    routeTarget: { kind: 'git-worktree', workspaceId, worktreePath },
    workspaceRuntimeId,
  }
}

export function gitBranchPaneTargetLease(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  branchName: string,
): GitBranchPaneTargetLease {
  return {
    routeTarget: { kind: 'git-branch', workspaceId, branchName },
    workspaceRuntimeId,
  }
}

export function gitBranchPaneTargetLeaseOwnerIsCurrent(lease: GitBranchPaneTargetLease): boolean {
  return (
    workspacesStore.getState().workspaces[lease.routeTarget.workspaceId]?.workspaceRuntimeId ===
    lease.workspaceRuntimeId
  )
}

export function filesystemWorkspacePaneTargetLeaseIsCurrent(lease: FilesystemWorkspacePaneTargetLease): boolean {
  const workspace = workspacesStore.getState().workspaces[lease.routeTarget.workspaceId]
  if (workspace?.workspaceRuntimeId !== lease.workspaceRuntimeId) return false
  if (lease.routeTarget.kind === 'workspace-root') return true
  const worktreePath = lease.routeTarget.worktreePath
  if (workspace.capability.kind !== 'git') return false
  const snapshot = getRepoSnapshotQueryData(lease.routeTarget.workspaceId, lease.workspaceRuntimeId)
  return snapshot?.worktrees.some((worktree) => worktree.path === worktreePath) ?? false
}

export type WorkspacePaneTabTargetUnavailableReason = 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: WorkspacePaneTabModel }
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: WorkspacePaneTabTargetUnavailableReason
      target: WorkspacePaneTabModel
    }

/** Narrows a ready or unavailable projection to the runtime epoch captured by an action. */
export function scopeWorkspacePaneTabTargetResolutionToRuntime(
  resolution: WorkspacePaneTabTargetResolution,
  workspaceRuntimeId: string,
): WorkspacePaneTabTargetResolution {
  if (
    resolution.kind === 'missing' ||
    workspacePaneTabModelWorkspaceRuntimeId(resolution.target) === workspaceRuntimeId
  )
    return resolution
  return { kind: 'missing' }
}

export interface WorkspacePaneTabTargetOptions {
  /**
   * `undefined` means no route context is available, so use persisted
   * workspace-pane preference. `null` is an explicit bare branch route and
   * therefore has no active pane tab.
   */
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
}

export const workspacePanePreferenceTargetOptions: WorkspacePaneTabTargetOptions = { workspacePaneRoute: undefined }

function filesystemExecutionTargetForPaneTarget(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
): WorkspacePaneFilesystemExecutionTarget | null {
  if (target.kind === 'workspace-root') {
    return workspaceRootFilesystemExecutionTarget(target.workspaceId, workspaceRuntimeId)
  }
  if (target.kind === 'git-worktree') {
    return gitWorktreeFilesystemExecutionTarget(target.workspaceId, workspaceRuntimeId, target.worktreePath)
  }
  return null
}

export interface GitWorktreeWorkspacePaneDestinationTargetLease {
  workspaceRuntimeId: string
  routeTarget: GitWorktreeWorkspacePaneTabsTarget
  canonicalBranch: string
  location: Extract<WorkspacePaneLocation, { kind: 'source-worktree' | 'linked-worktree' }>
}

export type WorkspacePaneDestinationTargetLease =
  GitBranchPaneTargetLease | GitWorktreeWorkspacePaneDestinationTargetLease

export function isGitWorktreeDestinationTargetLease(
  lease: WorkspacePaneDestinationTargetLease,
): lease is GitWorktreeWorkspacePaneDestinationTargetLease {
  return lease.routeTarget.kind === 'git-worktree'
}

export type WorkspacePaneDestinationTargetResolution =
  { kind: 'ready'; lease: WorkspacePaneDestinationTargetLease } | { kind: 'missing' }

export function resolveWorkspacePaneDestinationTarget(
  workspaceId: WorkspaceId,
  branchName: string,
): WorkspacePaneDestinationTargetResolution {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return { kind: 'missing' }
  const branchModel = getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId)
  const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
  if (!branchModel || !branch) return { kind: 'missing' }
  const worktree = repoWorktreeForBranch(branchModel.worktrees, branchName)
  if (!worktree) {
    return {
      kind: 'ready',
      lease: {
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        routeTarget: { kind: 'git-branch', workspaceId, branchName },
      },
    }
  }
  const location = workspacePaneLocationForWorktree(workspace.id, workspace.workspaceRuntimeId, worktree)
  return {
    kind: 'ready',
    lease: {
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      routeTarget: location.routeTarget,
      canonicalBranch: branchName,
      location,
    },
  }
}

export function resolveWorkspacePaneDestinationTargetLease(
  workspaceId: WorkspaceId,
  branchName: string,
): WorkspacePaneDestinationTargetLease | null {
  const resolution = resolveWorkspacePaneDestinationTarget(workspaceId, branchName)
  return resolution.kind === 'ready' ? resolution.lease : null
}

export function workspacePaneTargetLeaseIsCurrent(lease: WorkspacePaneDestinationTargetLease): boolean {
  const branchName = isGitWorktreeDestinationTargetLease(lease) ? lease.canonicalBranch : lease.routeTarget.branchName
  const current = resolveWorkspacePaneDestinationTargetLease(lease.routeTarget.workspaceId, branchName)
  if (!current || current.workspaceRuntimeId !== lease.workspaceRuntimeId) return false
  if (isGitWorktreeDestinationTargetLease(current)) {
    return (
      isGitWorktreeDestinationTargetLease(lease) &&
      current.canonicalBranch === lease.canonicalBranch &&
      current.routeTarget.worktreePath === lease.routeTarget.worktreePath
    )
  }
  return !isGitWorktreeDestinationTargetLease(lease) && current.routeTarget.branchName === lease.routeTarget.branchName
}

export function workspacePaneTabTargetForWorkspace(
  workspaceId: WorkspaceId,
  options: WorkspacePaneTabTargetOptions = workspacePanePreferenceTargetOptions,
): WorkspacePaneTabModel | null {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  if (!workspace) return null
  const resolution = resolveWorkspacePaneTabTargetForPaneTarget({
    location: workspacePaneLocationForRoot(workspaceId, workspace.workspaceRuntimeId),
    workspacePaneRoute: options.workspacePaneRoute,
  })
  return resolution.kind === 'ready' ? resolution.target : null
}

export interface WorkspacePaneTabTargetForPaneTargetInput {
  location: WorkspacePaneLocation
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
}

export function resolveWorkspacePaneTabTargetForPaneTarget(
  input: WorkspacePaneTabTargetForPaneTargetInput,
): WorkspacePaneTabTargetResolution {
  const { location, workspacePaneRoute } = input
  const { paneTarget } = location
  const workspace = workspacesStore.getState().workspaces[paneTarget.workspaceId]
  if (!workspace || workspace.workspaceRuntimeId !== location.workspaceRuntimeId) return { kind: 'missing' }
  if (paneTarget.kind !== 'workspace-root' && workspace.capability.kind !== 'git') return { kind: 'missing' }
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: location.kind === 'branch' ? null : workspacePaneLocationExecutionTarget(location),
  })
  const tabsProjection = readWorkspacePaneTabsProjectionForTarget({
    ...paneTarget,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  })
  const target = createWorkspacePaneTabModel({
    location,
    preferredTab: preferredWorkspacePaneTabForRoute(workspace.ui, location.routeTarget, { workspacePaneRoute }),
    allowPreferredTabFallback: workspacePaneRoute === undefined,
    tabEntries: tabsProjection.tabs,
    tabEntriesProjectionPhase: tabsProjection.phase,
    runtimeTabViews: runtimeProjection.runtimeTabViews,
    runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    requestedSessionIdByRuntimeType:
      workspacePaneRoute?.kind === 'terminal' ? { terminal: workspacePaneRoute.terminalSessionId } : undefined,
  })
  if (tabsProjection.phase !== 'ready') {
    return {
      kind: 'unavailable',
      reason: tabsProjection.phase === 'failed' ? 'workspace-pane-tabs-failed' : 'workspace-pane-tabs-pending',
      target,
    }
  }
  return { kind: 'ready', target }
}

export function workspacePaneTabTargetForPaneTarget(
  input: WorkspacePaneTabTargetForPaneTargetInput,
): WorkspacePaneTabModel | null {
  const resolution = resolveWorkspacePaneTabTargetForPaneTarget(input)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function workspacePaneRouteNavigationBlockedForBranch(workspaceId: WorkspaceId, branchName: string): boolean {
  const state = workspacesStore.getState()
  const workspace = state.workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return false
  const branchModel = getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId)
  if (!branchModel) return false
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return false
  const paneTarget = requiredGitWorkspacePaneTabsTarget(
    workspace.id,
    branchName,
    repoWorktreeForBranch(branchModel.worktrees, branchName)?.path ?? null,
  )
  const location = workspacePaneLocationForBranch(
    workspace.id,
    workspace.workspaceRuntimeId,
    branchName,
    repoWorktreeForBranch(branchModel.worktrees, branchName) ?? null,
  )
  if (
    workspacePaneTabsInteractionBlockedForTarget({
      ...location.paneTarget,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
    })
  )
    return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: location.kind === 'branch' ? null : workspacePaneLocationExecutionTarget(location),
  })
  return Object.values(runtimeProjection.runtimeTabStateByType).some((state) => state.createPending)
}

export function workspacePaneRouteNavigationBlockedForWorktree(
  workspaceId: WorkspaceId,
  worktreePath: string,
): boolean {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return false
  const snapshot = getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId)
  const worktree = snapshot?.worktrees.find((candidate) => candidate.path === worktreePath)
  if (!worktree) return false
  const location = workspacePaneLocationForWorktree(workspace.id, workspace.workspaceRuntimeId, worktree)
  const paneTarget = location.paneTarget
  if (workspacePaneTabsInteractionBlockedForTarget({ ...paneTarget, workspaceRuntimeId: workspace.workspaceRuntimeId }))
    return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: workspacePaneLocationExecutionTarget(location),
  })
  return Object.values(runtimeProjection.runtimeTabStateByType).some((state) => state.createPending)
}

function preferredWorkspacePaneTabForRoute(
  ui: WorkspacePanePreferenceState,
  target: WorkspacePaneTabsTarget | null | undefined,
  options: WorkspacePaneTabTargetOptions,
) {
  const route = options.workspacePaneRoute
  if (route === undefined) return preferredWorkspacePaneTabForTarget(ui, target)
  if (route === null) return null
  if (route.kind === 'static') return route.tab
  if (route.kind === 'terminal') return 'terminal'
  return null
}

export function workspacePaneTabTargetBlocksInteraction(model: WorkspacePaneTabModel): boolean {
  const paneTarget = workspacePaneTabModelPaneTarget(model)
  if (workspacePaneTabModelBlocksTabInteraction(model) || !paneTarget) return true
  return workspacePaneTabsInteractionBlockedForTarget({
    ...paneTarget,
    workspaceRuntimeId: workspacePaneTabModelWorkspaceRuntimeId(model),
  })
}

export function workspacePaneTargetBlocksInteraction(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
): boolean {
  if (workspacePaneTabsInteractionBlockedForTarget({ ...target, workspaceRuntimeId })) return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: target.workspaceId,
    workspaceRuntimeId,
    filesystemTarget: filesystemExecutionTargetForPaneTarget(target, workspaceRuntimeId),
  })
  return Object.values(runtimeProjection.runtimeTabStateByType).some((state) => state.createPending)
}
