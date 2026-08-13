import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { currentWorkspaceRuntimeId } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { workspacePaneTabControllerTargetIsCurrent } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import type { FilesystemWorkspacePaneRouteCommitActions } from '#/web/app-navigation-actions.ts'
import { beginWorkspacePaneDestinationPresentation } from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import {
  workspacePaneActionOutcomeSucceeded,
  type WorkspacePaneActionOutcome,
} from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  filesystemWorkspacePaneTargetLeaseForModel,
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  isGitWorktreeDestinationTargetLease,
  resolveWorkspacePaneDestinationTarget,
  workspacePaneTargetBlocksInteraction,
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
  workspacePaneTargetLeaseIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { beginAppNavigation } from '#/web/app-navigation-lifecycle.ts'
import {
  commitWorkspacePaneStaticTabPresentation,
  showWorkspacePaneTabOpenCommittedProjectionFailure,
  showWorkspacePaneTabOpenMutationFailure,
  workspacePaneStaticTabTransactionIsCurrent,
  type WorkspacePaneStaticTabRouteTransaction,
} from '#/web/workspace-pane/workspace-pane-tab-open-presentation.ts'

export interface OpenWorkspacePaneTargetStaticTabActionOptions {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: FilesystemWorkspacePaneRouteCommitActions
}

function paneTargetPresentationBranch(
  paneTarget: WorkspacePaneTabsTarget,
  worktreeHead: GitHead | undefined,
): string | null {
  if (paneTarget.kind === 'git-branch') return paneTarget.branchName
  if (worktreeHead?.kind === 'branch') return worktreeHead.branchName
  return null
}

/** Opens and presents a static tab as one target-scoped transaction. */
export async function dispatchOpenWorkspacePaneTargetStaticTabAction(
  input: OpenWorkspacePaneTargetStaticTabActionOptions,
): Promise<WorkspacePaneActionOutcome> {
  const workspace = workspacesStore.getState().workspaces[input.workspaceId]
  if (
    !workspace ||
    workspace.workspaceRuntimeId !== input.workspaceRuntimeId ||
    input.routeTarget.workspaceId !== input.workspaceId ||
    input.paneTarget.workspaceId !== input.workspaceId
  ) {
    return { kind: 'target-missing' }
  }
  const workspaceRuntimeId = input.workspaceRuntimeId
  const worktreePath = workspacePaneTabsTargetWorktreePath(input.paneTarget)
  const branchName = paneTargetPresentationBranch(input.paneTarget, input.worktreeHead)
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(input.paneTarget, workspaceRuntimeId, {
    workspacePaneRoute: input.workspacePaneRoute,
  })
  const placement: WorkspacePaneStaticTabPlacement = openerIdentity
    ? { kind: 'after-opener', openerIdentity }
    : { kind: 'append', openerIdentity: null }
  const resolvedInput: ResolvedWorkspacePaneStaticTabOpenInput = {
    workspaceId: input.workspaceId,
    workspaceRuntimeId,
    branchName,
    worktreePath,
    routeTarget: input.routeTarget,
    paneTarget: input.paneTarget,
    worktreeHead: input.worktreeHead,
    type: input.type,
    sourceRoute: input.workspacePaneRoute,
    placement,
    navigation: input.navigation,
  }
  const admission = workspacePaneStaticTabOpenAdmission(resolvedInput)
  if (admission) return admission
  const navigationGeneration = beginAppNavigation()
  const actionTarget = workspacePaneActionTargetFromCoordinates({
    workspaceId: input.workspaceId,
    workspaceRuntimeId,
    branchName,
    worktreePath,
  })
  return await runWorkspacePaneAction(actionTarget, () =>
    openWorkspacePaneStaticTabAction(resolvedInput, { kind: 'current', navigationGeneration }),
  )
}

export interface OpenWorkspacePaneStaticTabActionOptions {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: FilesystemWorkspacePaneRouteCommitActions
}

export interface ShowWorkspacePaneStaticTabActionOptions {
  workspaceId: WorkspaceId | null
  workspaceRuntimeId: string
  branchName: string | null
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: FilesystemWorkspacePaneRouteCommitActions
}

type WorkspacePaneStaticTabPlacement =
  { kind: 'after-opener'; openerIdentity: string } | { kind: 'append'; openerIdentity: string | null }

interface ResolvedWorkspacePaneStaticTabOpenInput {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  type: WorkspacePaneStaticTabType
  sourceRoute: ParsedWorkspacePaneRoute | null | undefined
  placement: WorkspacePaneStaticTabPlacement
  navigation: FilesystemWorkspacePaneRouteCommitActions
}

export async function dispatchShowWorkspacePaneStaticTabAction({
  workspaceId,
  workspaceRuntimeId,
  branchName,
  type,
  workspacePaneRoute,
  navigation,
}: ShowWorkspacePaneStaticTabActionOptions): Promise<WorkspacePaneActionOutcome> {
  if (!workspaceId || !branchName) return { kind: 'target-missing' }
  const resolution = resolveWorkspacePaneDestinationTarget(workspaceId, branchName)
  if (resolution.kind !== 'ready') return { kind: 'target-missing' }
  const lease = resolution.lease
  if (lease.workspaceRuntimeId !== workspaceRuntimeId) return { kind: 'target-missing' }
  const canonicalBranch = isGitWorktreeDestinationTargetLease(lease)
    ? lease.canonicalBranch
    : lease.routeTarget.branchName
  const worktreePath = isGitWorktreeDestinationTargetLease(lease) ? lease.routeTarget.worktreePath : null
  const paneTarget = lease.routeTarget
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(paneTarget, lease.workspaceRuntimeId, {
    workspacePaneRoute,
  })
  const input: ResolvedWorkspacePaneStaticTabOpenInput = {
    workspaceId,
    workspaceRuntimeId: lease.workspaceRuntimeId,
    branchName: canonicalBranch,
    worktreePath,
    routeTarget: paneTarget,
    paneTarget,
    type,
    sourceRoute: workspacePaneRoute,
    placement: { kind: 'append', openerIdentity },
    navigation,
  }
  const admission = workspacePaneStaticTabOpenAdmission(input)
  if (admission) return admission
  const presentation = beginWorkspacePaneDestinationPresentation(lease)
  return await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: lease.routeTarget.workspaceId,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      branchName: canonicalBranch,
      worktreePath,
    }),
    () =>
      openWorkspacePaneStaticTabAction(input, {
        kind: 'destination',
        presentation,
      }),
  )
}

export async function dispatchOpenWorkspacePaneStaticTabAction(
  input: OpenWorkspacePaneStaticTabActionOptions,
): Promise<boolean> {
  if (currentWorkspaceRuntimeId(workspacesStore.getState(), input.workspaceId) !== input.workspaceRuntimeId)
    return false
  const workspaceRuntimeId = input.workspaceRuntimeId
  const sourceRoute = input.workspacePaneRoute
  const paneTarget = requiredGitWorkspacePaneTabsTarget(input.workspaceId, input.branchName, input.worktreePath ?? null)
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(paneTarget, workspaceRuntimeId, {
    workspacePaneRoute: sourceRoute,
  })
  const placement: WorkspacePaneStaticTabPlacement = openerIdentity
    ? { kind: 'after-opener', openerIdentity }
    : { kind: 'append', openerIdentity: null }
  const resolvedInput: ResolvedWorkspacePaneStaticTabOpenInput = {
    workspaceId: input.workspaceId,
    workspaceRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath ?? null,
    routeTarget: paneTarget,
    paneTarget,
    type: input.type,
    sourceRoute,
    placement,
    navigation: input.navigation,
  }
  if (workspacePaneStaticTabOpenAdmission(resolvedInput)) return false
  const navigationGeneration = beginAppNavigation()
  const outcome = await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: input.workspaceId,
      workspaceRuntimeId,
      branchName: input.branchName,
      worktreePath: resolvedInput.worktreePath,
    }),
    () =>
      openWorkspacePaneStaticTabAction(resolvedInput, {
        kind: 'current',
        navigationGeneration,
      }),
  )
  return workspacePaneActionOutcomeSucceeded(outcome)
}

function workspacePaneStaticTabOpenAdmission(
  input: ResolvedWorkspacePaneStaticTabOpenInput,
): WorkspacePaneActionOutcome | null {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: input.paneTarget.kind !== 'git-branch' })) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  if (!workspacePaneStaticTabOpenTargetIsCurrent(input)) return { kind: 'target-missing' }
  if (workspacePaneTargetBlocksInteraction(input.paneTarget, input.workspaceRuntimeId)) return { kind: 'blocked' }
  return null
}

function workspacePaneStaticTabOpenTargetIsCurrent(input: ResolvedWorkspacePaneStaticTabOpenInput): boolean {
  const filesystemLease = filesystemWorkspacePaneTargetLeaseForModel(input)
  if (filesystemLease) return filesystemWorkspacePaneTargetLeaseIsCurrent(filesystemLease)
  if (
    input.routeTarget.kind !== 'git-branch' ||
    input.paneTarget.kind !== 'git-branch' ||
    input.routeTarget.branchName !== input.paneTarget.branchName ||
    input.routeTarget.branchName !== input.branchName ||
    input.worktreePath !== null
  ) {
    return false
  }
  return workspacePaneTargetLeaseIsCurrent({
    routeTarget: input.routeTarget,
    workspaceRuntimeId: input.workspaceRuntimeId,
  })
}

async function openWorkspacePaneStaticTabAction(
  input: ResolvedWorkspacePaneStaticTabOpenInput,
  transaction: WorkspacePaneStaticTabRouteTransaction,
): Promise<WorkspacePaneActionOutcome> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: input.paneTarget.kind !== 'git-branch' })) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  if (!workspacePaneStaticTabTransactionIsCurrent(transaction)) return { kind: 'superseded' }
  const state = workspacesStore.getState()
  const workspace = state.workspaces[input.workspaceId]
  if (!workspace) return { kind: 'target-missing' }
  if (workspace.workspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'superseded' }
  if (!workspacePaneStaticTabOpenTargetIsCurrent(input)) return { kind: 'superseded' }
  const sourceRoute = input.sourceRoute
  const modelBefore = resolveOpenWorkspacePaneStaticTabModel(input)
  if (
    modelBefore
      ? workspacePaneTabTargetBlocksInteraction(modelBefore)
      : workspacePaneTargetBlocksInteraction(input.paneTarget, input.workspaceRuntimeId)
  ) {
    return { kind: 'blocked' }
  }
  const target = { ...input.paneTarget, workspaceRuntimeId: input.workspaceRuntimeId }
  // Chrome-tab-style opener tracking: reopening/refocusing an already-open
  // static tab shouldn't overwrite its opener.
  const currentTabs = readWorkspacePaneTabsForTarget(target)
  const alreadyOpen = currentTabs.some((entry) => entry.type === input.type)
  const openerIdentity = alreadyOpen ? null : input.placement.openerIdentity
  const insertAfterIdentity = input.placement.kind === 'after-opener' ? input.placement.openerIdentity : null
  const committed = await updateWorkspacePaneTabs({
    ...target,
    operation: {
      type: 'open-static',
      tabType: input.type,
      insertAfterIdentity,
    },
  })
  if (!committed.ok) {
    showWorkspacePaneTabOpenMutationFailure(committed.error)
    return { kind: 'mutation-failed' }
  }
  if (committed.projection === 'failed') {
    showWorkspacePaneTabOpenCommittedProjectionFailure()
    return { kind: 'committed-projection-failed' }
  }
  if (committed.projection === 'superseded') return { kind: 'superseded' }
  const model = resolveOpenWorkspacePaneStaticTabModel(input)
  if (!model || !workspacePaneTabControllerTargetIsCurrent(model)) return { kind: 'superseded' }
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(
      input.paneTarget,
      input.workspaceRuntimeId,
      workspacePaneStaticTabId(input.type),
      openerIdentity,
    )
  }
  if (!workspacePaneStaticTabTransactionIsCurrent(transaction)) {
    return { kind: 'completed', changed: !alreadyOpen, presentation: 'superseded' }
  }
  const navigationOutcome = await commitWorkspacePaneStaticTabPresentation(
    { ...input, model },
    sourceRoute,
    transaction,
  )
  if (!workspacePaneActionOutcomeSucceeded(navigationOutcome)) return navigationOutcome
  return navigationOutcome.kind === 'completed' ? { ...navigationOutcome, changed: !alreadyOpen } : navigationOutcome
}

function resolveOpenWorkspacePaneStaticTabModel(input: ResolvedWorkspacePaneStaticTabOpenInput) {
  return workspacePaneTabTargetForPaneTarget({
    paneTarget: input.paneTarget,
    routeTarget: input.routeTarget,
    workspacePaneRoute: input.sourceRoute,
    worktreeHead:
      input.worktreeHead ??
      (input.paneTarget.kind === 'git-worktree' && input.branchName
        ? { kind: 'branch', branchName: input.branchName }
        : undefined),
  })
}
