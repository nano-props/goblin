import {
  createWorkspacePaneTabModel,
  workspacePaneTabModelBlocksTabInteraction,
  type WorkspacePaneModelTarget,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import {
  preferredWorkspacePaneTabForTarget,
  type WorkspacePanePreferenceState,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
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
import type { GitHead } from '#/shared/git-head.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import {
  gitWorktreeFilesystemExecutionTarget,
  workspaceRootFilesystemExecutionTarget,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'

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
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  routeTarget: WorkspacePaneModelTarget
  paneTarget: WorkspacePaneModelTarget
  branchName: string | null
  worktreePath: string | null
}

export function filesystemWorkspacePaneTargetLeaseForModel(
  model: FilesystemWorkspacePaneTargetLeaseSource,
): FilesystemWorkspacePaneTargetLease | null {
  const routeTarget = model.routeTarget
  if (routeTarget.kind === 'workspace-root') {
    return model.paneTarget.kind === 'workspace-root' &&
      model.branchName === null &&
      routeTarget.workspaceId === model.workspaceId
      ? { routeTarget, workspaceRuntimeId: model.workspaceRuntimeId }
      : null
  }
  if (
    routeTarget.kind !== 'git-worktree' ||
    model.paneTarget.kind !== 'git-worktree' ||
    routeTarget.workspaceId !== model.workspaceId ||
    routeTarget.worktreePath !== model.paneTarget.worktreePath ||
    routeTarget.worktreePath !== model.worktreePath
  ) {
    return null
  }
  return {
    routeTarget,
    workspaceRuntimeId: model.workspaceRuntimeId,
  }
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

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: WorkspacePaneTabModel }
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'snapshot-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
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
  return {
    kind: 'ready',
    lease: worktree
      ? {
          workspaceRuntimeId: workspace.workspaceRuntimeId,
          routeTarget: { kind: 'git-worktree', workspaceId, worktreePath: worktree.path },
          canonicalBranch: branchName,
        }
      : {
          workspaceRuntimeId: workspace.workspaceRuntimeId,
          routeTarget: { kind: 'git-branch', workspaceId, branchName },
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
  const resolution = resolveWorkspacePaneTabTarget(workspaceId, null, workspaceId, options)
  return resolution.kind === 'ready' ? resolution.target : null
}

function resolveWorkspacePaneTabTarget(
  workspaceId: WorkspaceId,
  branchName: string | null,
  worktreePath: string | null,
  options: WorkspacePaneTabTargetOptions,
): WorkspacePaneTabTargetResolution {
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  if (!workspace) return { kind: 'missing' }
  if (branchName !== null && workspace.capability.kind !== 'git') return { kind: 'missing' }
  const paneTarget: WorkspacePaneTabsTarget =
    branchName === null
      ? { kind: 'workspace-root', workspaceId }
      : requiredGitWorkspacePaneTabsTarget(workspaceId, branchName, worktreePath)
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: filesystemExecutionTargetForPaneTarget(paneTarget, workspace.workspaceRuntimeId),
  })
  const tabEntriesProjection = readWorkspacePaneTabsProjectionForTarget({
    ...paneTarget,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  })
  if (tabEntriesProjection.phase !== 'ready') {
    return {
      kind: 'unavailable',
      reason: tabEntriesProjection.phase === 'failed' ? 'workspace-pane-tabs-failed' : 'workspace-pane-tabs-pending',
    }
  }
  return {
    kind: 'ready',
    target: createWorkspacePaneTabModel({
      workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      routeTarget: paneTarget,
      paneTarget,
      worktreeHead: paneTarget.kind === 'git-worktree' && branchName ? { kind: 'branch', branchName } : undefined,
      preferredTab: preferredWorkspacePaneTabForRoute(workspace.ui, paneTarget, options),
      allowPreferredTabFallback: options.workspacePaneRoute === undefined,
      tabEntries: tabEntriesProjection.tabs,
      tabEntriesProjectionPhase: tabEntriesProjection.phase,
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType:
        options.workspacePaneRoute?.kind === 'terminal'
          ? { terminal: options.workspacePaneRoute.terminalSessionId }
          : undefined,
    }),
  }
}

export function workspacePaneTabTargetForPaneTarget(input: {
  paneTarget: WorkspacePaneTabsTarget
  routeTarget: WorkspacePaneTabsTarget
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  worktreeHead?: GitHead
}): WorkspacePaneTabModel | null {
  const { paneTarget, routeTarget, workspacePaneRoute, worktreeHead } = input
  const workspace = workspacesStore.getState().workspaces[paneTarget.workspaceId]
  if (!workspace) return null
  if (paneTarget.kind !== 'workspace-root' && workspace.capability.kind !== 'git') return null
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: filesystemExecutionTargetForPaneTarget(paneTarget, workspace.workspaceRuntimeId),
  })
  const tabsProjection = readWorkspacePaneTabsProjectionForTarget({
    ...paneTarget,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  })
  if (tabsProjection.phase !== 'ready') return null
  return createWorkspacePaneTabModel({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    routeTarget,
    paneTarget,
    worktreeHead,
    preferredTab: preferredWorkspacePaneTabForRoute(workspace.ui, paneTarget, { workspacePaneRoute }),
    allowPreferredTabFallback: workspacePaneRoute === undefined,
    tabEntries: tabsProjection.tabs,
    tabEntriesProjectionPhase: tabsProjection.phase,
    runtimeTabViews: runtimeProjection.runtimeTabViews,
    runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
    requestedSessionIdByRuntimeType:
      workspacePaneRoute?.kind === 'terminal' ? { terminal: workspacePaneRoute.terminalSessionId } : undefined,
  })
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
  if (workspacePaneTabsInteractionBlockedForTarget({ ...paneTarget, workspaceRuntimeId: workspace.workspaceRuntimeId }))
    return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: filesystemExecutionTargetForPaneTarget(paneTarget, workspace.workspaceRuntimeId),
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
  if (!snapshot?.worktrees.some((worktree) => worktree.path === worktreePath)) return false
  const paneTarget = { kind: 'git-worktree' as const, workspaceId: workspace.id, worktreePath }
  if (workspacePaneTabsInteractionBlockedForTarget({ ...paneTarget, workspaceRuntimeId: workspace.workspaceRuntimeId }))
    return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget: gitWorktreeFilesystemExecutionTarget(workspace.id, workspace.workspaceRuntimeId, worktreePath),
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
  if (workspacePaneTabModelBlocksTabInteraction(model) || model.paneTarget.kind === 'inactive') return true
  return workspacePaneTabsInteractionBlockedForTarget({
    ...model.paneTarget,
    workspaceRuntimeId: model.workspaceRuntimeId,
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
