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
import { readSuccessfulRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneTabsInteractionBlockedForTarget } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  runtimeWorkspacePaneTargetKey,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import {
  gitWorktreeFilesystemExecutionTarget,
  workspaceRootFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import {
  getRepoProjectionQueryStatus,
  getRepoWorktreeStatusQueryStatus,
  getSuccessfulRepoWorktreeStatusQueryData,
} from '#/web/repo-query-cache.ts'
import {
  terminalExecutionPath,
  terminalSessionCoordinates,
  type TerminalRetirementPresentationContext,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'

export type FilesystemWorkspacePaneTargetLease =
  | {
      routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'workspace-root' }>
      workspaceRuntimeId: string
      authority: { kind: 'workspace-runtime' }
    }
  | {
      routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'git-worktree' }>
      workspaceRuntimeId: string
      authority: { kind: 'branch'; branchName: string } | { kind: 'detached-worktree' }
    }

export function filesystemWorkspacePaneTargetLeaseForModel(
  model: Pick<
    WorkspacePaneTabModel,
    'workspaceId' | 'workspaceRuntimeId' | 'routeTarget' | 'paneTarget' | 'branchName' | 'worktreePath'
  >,
): FilesystemWorkspacePaneTargetLease | null {
  const routeTarget = model.routeTarget
  if (routeTarget.kind === 'workspace-root') {
    return model.paneTarget.kind === 'workspace-root' &&
      model.branchName === null &&
      routeTarget.workspaceId === model.workspaceId
      ? { routeTarget, workspaceRuntimeId: model.workspaceRuntimeId, authority: { kind: 'workspace-runtime' } }
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
    authority: model.branchName ? { kind: 'branch', branchName: model.branchName } : { kind: 'detached-worktree' },
  }
}

export function workspaceRootPaneTargetLease(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): FilesystemWorkspacePaneTargetLease {
  return {
    routeTarget: { kind: 'workspace-root', workspaceId },
    workspaceRuntimeId,
    authority: { kind: 'workspace-runtime' },
  }
}

export function gitWorktreePaneTargetLease(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  worktreePath: string,
  head: GitHead,
): FilesystemWorkspacePaneTargetLease {
  return {
    routeTarget: { kind: 'git-worktree', workspaceId, worktreePath },
    workspaceRuntimeId,
    authority: head.kind === 'branch' ? { kind: 'branch', branchName: head.branchName } : { kind: 'detached-worktree' },
  }
}

export function filesystemWorkspacePaneTargetLeaseIsCurrent(lease: FilesystemWorkspacePaneTargetLease): boolean {
  return filesystemWorkspacePaneTargetLeaseCurrentness(lease) === 'current'
}

export function filesystemWorkspacePaneTargetLeaseCurrentness(
  lease: FilesystemWorkspacePaneTargetLease,
): WorkspacePaneTargetCurrentness {
  const workspace = useWorkspacesStore.getState().workspaces[lease.routeTarget.workspaceId]
  if (!workspace) return 'stale'
  if (workspace.workspaceRuntimeId !== lease.workspaceRuntimeId) return 'stale'
  if (lease.routeTarget.kind === 'workspace-root') return 'current'
  if (workspace.capability.kind === 'probing') return 'pending'
  if (workspace.capability.kind !== 'git') return 'stale'
  const worktreePath = lease.routeTarget.worktreePath
  const worktreeStatusQuery = getRepoWorktreeStatusQueryStatus(lease.routeTarget.workspaceId, lease.workspaceRuntimeId)
  if (worktreeStatusQuery === 'pending') return 'pending'
  if (worktreeStatusQuery === 'error') return 'stale'
  const worktreeStatus = getSuccessfulRepoWorktreeStatusQueryData(
    lease.routeTarget.workspaceId,
    lease.workspaceRuntimeId,
  )
  if (!worktreeStatus) return 'stale'
  if (lease.authority.kind === 'branch') {
    const branchName = lease.authority.branchName
    const branchCurrentness = workspacePaneTargetLeaseCurrentness({
      workspaceId: lease.routeTarget.workspaceId,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      branchName,
      worktreePath,
    })
    if (branchCurrentness !== 'current') return branchCurrentness
    return worktreeStatus.status.some((worktree) => worktree.path === worktreePath && worktree.branch === branchName)
      ? 'current'
      : 'stale'
  }
  return worktreeStatus.status.some((worktree) => worktree.path === worktreePath && worktree.branch === undefined)
    ? 'current'
    : 'stale'
}

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
export type WorkspacePaneTargetCurrentness = 'current' | 'pending' | 'stale'

export type WorkspacePaneDestinationTargetResolution =
  { kind: 'ready'; lease: WorkspacePaneDestinationTargetLease } | { kind: 'missing' }

export function resolveWorkspacePaneDestinationTarget(
  workspaceId: WorkspaceId,
  branchName: string,
): WorkspacePaneDestinationTargetResolution {
  const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
  if (!workspace || workspace.capability.kind !== 'git') return { kind: 'missing' }
  const branchModel = readSuccessfulRepoBranchSnapshotQueryProjection(workspace)
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
  return workspacePaneTargetLeaseCurrentness(lease) === 'current'
}

export function workspacePaneTargetLeaseCurrentness(lease: WorkspacePaneTargetLease): WorkspacePaneTargetCurrentness {
  const workspace = useWorkspacesStore.getState().workspaces[lease.workspaceId]
  if (!workspace) return 'stale'
  if (workspace.workspaceRuntimeId !== lease.workspaceRuntimeId) return 'stale'
  if (workspace.capability.kind === 'probing') return 'pending'
  if (workspace.capability.kind !== 'git') return 'stale'
  const projectionStatus = getRepoProjectionQueryStatus(lease.workspaceId, lease.workspaceRuntimeId, null, 'full')
  if (projectionStatus === 'pending') return 'pending'
  if (projectionStatus === 'error') return 'stale'
  const current = resolveWorkspacePaneDestinationTargetLease(lease.workspaceId, lease.branchName)
  return current !== null &&
    current.workspaceRuntimeId === lease.workspaceRuntimeId &&
    current.worktreePath === lease.worktreePath
    ? 'current'
    : 'stale'
}

export function workspacePaneCommittedRuntimeTargetIsCurrent(target: WorkspacePaneTargetLease): boolean {
  if (!target.worktreePath) return false
  const workspace = useWorkspacesStore.getState().workspaces[target.workspaceId]
  if (!workspace || workspace.capability.kind !== 'git' || workspace.workspaceRuntimeId !== target.workspaceRuntimeId)
    return false
  return (
    readSuccessfulRepoBranchSnapshotQueryProjection(workspace)?.branches.some(
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
    filesystemTarget:
      branchName === null
        ? workspaceRootFilesystemExecutionTarget(workspaceId, workspace.workspaceRuntimeId)
        : worktreePath
          ? gitWorktreeFilesystemExecutionTarget(workspaceId, workspace.workspaceRuntimeId, worktreePath)
          : null,
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
      routeTarget:
        branchName === null ? { kind: 'workspace-root', workspaceId } : { kind: 'git-branch', workspaceId, branchName },
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

export function workspacePaneTabTargetForPaneTarget(input: {
  paneTarget: WorkspacePaneTabsTarget
  routeTarget: WorkspacePaneTabsTarget
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  worktreeHead?: GitHead
}): WorkspacePaneTabModel | null {
  const { paneTarget, routeTarget, workspacePaneRoute, worktreeHead } = input
  const workspace = useWorkspacesStore.getState().workspaces[paneTarget.workspaceId]
  if (!workspace) return null
  if (paneTarget.kind !== 'workspace-root' && workspace.capability.kind !== 'git') return null
  const worktreePath = workspacePaneTabsTargetWorktreePath(paneTarget)
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    filesystemTarget:
      paneTarget.kind === 'workspace-root'
        ? workspaceRootFilesystemExecutionTarget(workspace.id, workspace.workspaceRuntimeId)
        : paneTarget.kind === 'git-worktree'
          ? gitWorktreeFilesystemExecutionTarget(workspace.id, workspace.workspaceRuntimeId, paneTarget.worktreePath)
          : null,
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

/**
 * Reads the complete pane projection at an accepted terminal-retirement
 * boundary. The terminal base already owns the runtime and filesystem target,
 * so capture must not wait for the broader command-target read models to
 * rediscover those coordinates.
 */
export type RetiredTerminalWorkspacePaneTabTargetResolution =
  | { kind: 'ready'; paneTarget: WorkspacePaneTabsTarget; target: WorkspacePaneTabModel }
  | { kind: 'unavailable'; paneTarget: WorkspacePaneTabsTarget }

export function resolveRetiredTerminalWorkspacePaneTabTarget(input: {
  routeTarget: WorkspacePaneTabsTarget
  workspacePaneRoute: ParsedWorkspacePaneRoute | null
  terminalBase: TerminalSessionBase
  retirementPresentation: TerminalRetirementPresentationContext
}): RetiredTerminalWorkspacePaneTabTargetResolution {
  const coordinates = terminalSessionCoordinates(input.terminalBase)
  const paneTarget: WorkspacePaneTabsTarget =
    input.terminalBase.target.kind === 'workspace-root'
      ? { kind: 'workspace-root', workspaceId: coordinates.workspaceId }
      : {
          kind: 'git-worktree',
          workspaceId: coordinates.workspaceId,
          worktreePath: terminalExecutionPath(input.terminalBase.target),
        }
  if (
    input.routeTarget.workspaceId !== coordinates.workspaceId ||
    !retiredTerminalRouteTargetMatchesBase(input.routeTarget, paneTarget, input.terminalBase) ||
    runtimeWorkspacePaneTargetKey(input.retirementPresentation.target) !==
      runtimeWorkspacePaneTargetKey(input.terminalBase.target)
  ) {
    return { kind: 'unavailable', paneTarget }
  }
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    workspaceId: coordinates.workspaceId,
    workspaceRuntimeId: coordinates.workspaceRuntimeId,
    filesystemTarget: input.terminalBase.target,
  })
  const tabEntries = input.retirementPresentation.tabsBeforeRetirement
  return {
    kind: 'ready',
    paneTarget,
    target: createWorkspacePaneTabModel({
      workspaceId: coordinates.workspaceId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      routeTarget: input.routeTarget,
      paneTarget,
      worktreeHead:
        input.terminalBase.presentation.kind === 'git-worktree' ? input.terminalBase.presentation.head : undefined,
      // Retirement capture is only valid for the exact terminal route checked
      // by the caller, so it does not need hydrated workspace preferences.
      preferredTab: 'terminal',
      allowPreferredTabFallback: false,
      tabEntries,
      tabEntriesProjectionPhase: 'ready',
      runtimeTabViews: runtimeProjection.runtimeTabViews,
      runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
      requestedSessionIdByRuntimeType:
        input.workspacePaneRoute?.kind === 'terminal'
          ? { terminal: input.workspacePaneRoute.terminalSessionId }
          : undefined,
    }),
  }
}

function retiredTerminalRouteTargetMatchesBase(
  routeTarget: WorkspacePaneTabsTarget,
  paneTarget: WorkspacePaneTabsTarget,
  terminalBase: TerminalSessionBase,
): boolean {
  if (paneTarget.kind === 'workspace-root') return routeTarget.kind === 'workspace-root'
  if (paneTarget.kind !== 'git-worktree' || terminalBase.presentation.kind !== 'git-worktree') return false
  if (routeTarget.kind === 'git-worktree') return routeTarget.worktreePath === paneTarget.worktreePath
  return (
    routeTarget.kind === 'git-branch' &&
    terminalBase.presentation.head.kind === 'branch' &&
    routeTarget.branchName === terminalBase.presentation.head.branchName
  )
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
  const branchModel = readSuccessfulRepoBranchSnapshotQueryProjection(workspace)
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
    filesystemTarget: branch.worktree?.path
      ? gitWorktreeFilesystemExecutionTarget(workspace.id, workspace.workspaceRuntimeId, branch.worktree.path)
      : null,
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
  const branchModel = readSuccessfulRepoBranchSnapshotQueryProjection(workspace)
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
  if (workspacePaneTabModelBlocksTabInteraction(model) || model.paneTarget.kind === 'inactive') return true
  return workspacePaneTabsInteractionBlockedForTarget(model.paneTarget)
}
