import {
  createWorkspacePaneTabModel,
  workspacePaneTabModelBlocksTabInteraction,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneTabsInteractionBlockedForTarget } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: WorkspacePaneTabModel }
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'branch-read-model-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
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

export interface WorkspacePaneDestinationTargetLease {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string
  worktreePath: string | null
}

export type WorkspacePaneTargetLease = WorkspacePaneDestinationTargetLease

export type WorkspacePaneDestinationTargetResolution =
  { kind: 'ready'; lease: WorkspacePaneDestinationTargetLease } | { kind: 'missing' }

export function resolveWorkspacePaneDestinationTarget(
  workspaceId: WorkspaceId,
  branchName: string,
): WorkspacePaneDestinationTargetResolution {
  const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return { kind: 'missing' }
  const branchModel = readRepoBranchSnapshotQueryProjection(workspace)
  const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return { kind: 'missing' }
  const worktreePath = branch.worktree?.path ?? null
  return {
    kind: 'ready',
    lease: {
      workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      branchName,
      worktreePath,
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

export function workspacePaneTargetLeaseIsCurrent(lease: WorkspacePaneTargetLease): boolean {
  const current = resolveWorkspacePaneDestinationTargetLease(lease.workspaceId, lease.branchName)
  return (
    current !== null &&
    current.workspaceRuntimeId === lease.workspaceRuntimeId &&
    current.worktreePath === lease.worktreePath
  )
}

export function workspacePaneCommittedRuntimeTargetIsCurrent(target: WorkspacePaneTargetLease): boolean {
  if (!target.worktreePath) return false
  const workspace = useWorkspacesStore.getState().workspaces[target.workspaceId]
  if (!workspace || workspace.capability.kind !== 'git' || workspace.workspaceRuntimeId !== target.workspaceRuntimeId)
    return false
  return (
    readRepoBranchSnapshotQueryProjection(workspace)?.branches.some(
      (branch) => branch.worktree?.path === target.worktreePath,
    ) ?? false
  )
}

export function workspacePaneTabTargetForBranch(
  workspaceId: WorkspaceId,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): WorkspacePaneTabModel | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(workspaceId, branchName, options)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function workspacePaneTabTargetForCreatedRuntime(
  workspaceId: WorkspaceId,
  canonicalBranch: string,
  worktreePath: string,
  options: WorkspacePaneTabTargetOptions,
): WorkspacePaneTabModel | null {
  const resolution = resolveWorkspacePaneTabTarget(workspaceId, canonicalBranch, worktreePath, options)
  return resolution.kind === 'ready' ? resolution.target : null
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
  const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
  if (!workspace) return { kind: 'missing' }
  if (branchName !== null && workspace.capability.kind !== 'git') return { kind: 'missing' }
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspaceId,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    worktreePath,
  })
  const tabEntriesProjection = readWorkspacePaneTabsProjectionForTarget(
    branchName === null
      ? {
          kind: 'workspace-root',
          workspaceId: workspaceId,
          workspaceRuntimeId: workspace.workspaceRuntimeId,
        }
      : {
          ...requiredGitWorkspacePaneTabsTarget(workspaceId, branchName, worktreePath),
          workspaceRuntimeId: workspace.workspaceRuntimeId,
        },
  )
  if (tabEntriesProjection.phase !== 'ready') {
    return {
      kind: 'unavailable',
      reason: tabEntriesProjection.phase === 'failed' ? 'workspace-pane-tabs-failed' : 'workspace-pane-tabs-pending',
    }
  }
  const preferenceTarget =
    branchName === null
      ? { kind: 'workspace-root' as const, workspaceId: workspaceId }
      : requiredGitWorkspacePaneTabsTarget(workspaceId, branchName, worktreePath)
  return {
    kind: 'ready',
    target: createWorkspacePaneTabModel({
      workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      paneTarget: preferenceTarget,
      worktreeHead: preferenceTarget.kind === 'git-worktree' && branchName ? { kind: 'branch', branchName } : undefined,
      preferredTab: preferredWorkspacePaneTabForRoute(workspace.ui, preferenceTarget, options),
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

export function workspacePaneTabTargetForPaneTarget(
  paneTarget: WorkspacePaneTabsTarget,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  worktreeHead?: GitHead,
): WorkspacePaneTabModel | null {
  const workspace = useWorkspacesStore.getState().workspaces[paneTarget.workspaceId]
  if (!workspace) return null
  if (paneTarget.kind !== 'workspace-root' && workspace.capability.kind !== 'git') return null
  const worktreePath = workspacePaneTabsTargetWorktreePath(paneTarget)
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    worktreePath,
  })
  const tabsProjection = readWorkspacePaneTabsProjectionForTarget({
    ...paneTarget,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  })
  if (tabsProjection.phase !== 'ready') return null
  return createWorkspacePaneTabModel({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
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

export function workspacePaneTabInteractionBlockedForBranch(
  workspaceId: WorkspaceId,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): boolean {
  const resolution = resolveWorkspacePaneTabTargetForBranch(workspaceId, branchName, options)
  if (resolution.kind === 'unavailable') return true
  return resolution.kind === 'ready' ? workspacePaneTabTargetBlocksInteraction(resolution.target) : false
}

export function workspacePaneRouteNavigationBlockedForBranch(workspaceId: WorkspaceId, branchName: string): boolean {
  const state = useWorkspacesStore.getState()
  const workspace = state.workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return false
  const branchModel = readRepoBranchSnapshotQueryProjection(workspace)
  if (!branchModel) return false
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return false
  if (
    workspacePaneTabsInteractionBlockedForTarget({
      ...requiredGitWorkspacePaneTabsTarget(workspace.id, branchName, branch.worktree?.path ?? null),
    })
  )
    return true
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    worktreePath: branch.worktree?.path ?? null,
  })
  return Object.values(runtimeProjection.runtimeTabStateByType).some((state) => state.createPending)
}

export function resolveWorkspacePaneTabTargetForBranch(
  workspaceId: WorkspaceId,
  branchName: string,
  options: WorkspacePaneTabTargetOptions,
): WorkspacePaneTabTargetResolution {
  const state = useWorkspacesStore.getState()
  const workspace = state.workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return { kind: 'missing' }
  const branchModel = readRepoBranchSnapshotQueryProjection(workspace)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return { kind: 'missing' }
  const worktreePath = branch.worktree?.path ?? null
  return resolveWorkspacePaneTabTarget(workspaceId, branchName, worktreePath, options)
}

function preferredWorkspacePaneTabForRoute(
  ui: Parameters<typeof preferredWorkspacePaneTabForTarget>[0],
  target: Parameters<typeof preferredWorkspacePaneTabForTarget>[1],
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
  const target =
    model.branchName === null
      ? { kind: 'workspace-root' as const, workspaceId: model.workspaceId }
      : requiredGitWorkspacePaneTabsTarget(model.workspaceId, model.branchName, model.worktreePath)
  return workspacePaneTabModelBlocksTabInteraction(model) || workspacePaneTabsInteractionBlockedForTarget(target)
}
