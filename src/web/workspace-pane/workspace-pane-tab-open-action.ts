import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { requestVisibleRepoProjectionRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { currentRepoRuntimeId } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  commitWorkspacePaneCurrentTargetRoute,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  beginWorkspacePaneDestinationPresentation,
  commitWorkspacePaneDestinationRoute,
  workspacePaneDestinationPresentationIsCurrent,
  type WorkspacePaneDestinationPresentation,
} from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import {
  workspacePaneActionOutcomeSucceeded,
  type WorkspacePaneActionOutcome,
} from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  resolveWorkspacePaneDestinationTarget,
  workspacePaneTabInteractionBlockedForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

export interface OpenWorkspacePaneStaticTabActionOptions {
  repoId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation
}

export interface ShowWorkspacePaneStaticTabActionOptions {
  repoId: string | null
  branchName: string | null
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation
}

type WorkspacePaneStaticTabPlacement =
  { kind: 'after-opener'; openerIdentity: string } | { kind: 'append'; openerIdentity: string | null }

type ResolvedOpenWorkspacePaneStaticTabActionOptions = Omit<
  OpenWorkspacePaneStaticTabActionOptions,
  'worktreePath' | 'workspacePaneRoute'
> & {
  repoRuntimeId: string
  worktreePath: string | null
  sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  placement: WorkspacePaneStaticTabPlacement
}

export async function dispatchShowWorkspacePaneStaticTabAction({
  repoId,
  branchName,
  type,
  workspacePaneRoute,
  navigation,
}: ShowWorkspacePaneStaticTabActionOptions): Promise<WorkspacePaneActionOutcome> {
  if (!repoId || !branchName) return { kind: 'target-missing' }
  const resolution = resolveWorkspacePaneDestinationTarget(repoId, branchName)
  if (resolution.kind !== 'ready') return { kind: 'target-missing' }
  const lease = resolution.lease
  const provider = workspacePaneStaticTabProvider(type)
  if (!provider.canOpen({ hasWorktree: lease.worktreePath !== null })) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(repoId, lease.repoRuntimeId, lease.branchName, {
    workspacePaneRoute,
  })
  const presentation = beginWorkspacePaneDestinationPresentation(lease)
  const input: ResolvedOpenWorkspacePaneStaticTabActionOptions = {
    repoId,
    repoRuntimeId: lease.repoRuntimeId,
    branchName: lease.branchName,
    worktreePath: lease.worktreePath,
    type,
    sourceRoute: workspacePaneRoute,
    placement: { kind: 'append', openerIdentity },
    navigation,
  }
  return await runWorkspacePaneTabCoordinatorTask(lease, () =>
    openWorkspacePaneStaticTabAction(input, {
      kind: 'destination',
      presentation,
    }),
  )
}

export async function dispatchOpenWorkspacePaneStaticTabAction(
  input: OpenWorkspacePaneStaticTabActionOptions,
): Promise<boolean> {
  const repoRuntimeId = currentRepoRuntimeId(useReposStore.getState(), input.repoId)
  if (!repoRuntimeId) return false
  const sourceRoute = input.workspacePaneRoute
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(input.repoId, repoRuntimeId, input.branchName, {
    workspacePaneRoute: sourceRoute,
  })
  const placement: WorkspacePaneStaticTabPlacement = openerIdentity
    ? { kind: 'after-opener', openerIdentity }
    : { kind: 'append', openerIdentity: null }
  const resolvedInput: ResolvedOpenWorkspacePaneStaticTabActionOptions = {
    repoId: input.repoId,
    repoRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath ?? null,
    type: input.type,
    sourceRoute,
    placement,
    navigation: input.navigation,
  }
  const presentationToken = beginPrimaryWindowPresentation()
  const outcome = await runWorkspacePaneTabCoordinatorTask(
    {
      repoId: input.repoId,
      repoRuntimeId,
      branchName: input.branchName,
      worktreePath: resolvedInput.worktreePath,
    },
    () =>
      openWorkspacePaneStaticTabAction(resolvedInput, {
        kind: 'current',
        presentationToken,
      }),
  )
  return workspacePaneActionOutcomeSucceeded(outcome)
}

type WorkspacePaneStaticTabRouteTransaction =
  | {
      kind: 'current'
      presentationToken: PrimaryWindowPresentationToken
    }
  | {
      kind: 'destination'
      presentation: WorkspacePaneDestinationPresentation
    }

async function openWorkspacePaneStaticTabAction(
  input: ResolvedOpenWorkspacePaneStaticTabActionOptions,
  transaction: WorkspacePaneStaticTabRouteTransaction,
): Promise<WorkspacePaneActionOutcome> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  if (transaction.kind === 'destination' && !workspacePaneDestinationPresentationIsCurrent(transaction.presentation)) {
    return { kind: 'superseded' }
  }
  if (transaction.kind === 'current' && !primaryWindowPresentationIsCurrent(transaction.presentationToken)) {
    return { kind: 'superseded' }
  }
  if (
    transaction.kind === 'current' &&
    workspacePaneTabInteractionBlockedForBranch(input.repoId, input.branchName, {
      workspacePaneRoute: input.sourceRoute,
    })
  )
    return { kind: 'blocked' }
  const state = useReposStore.getState()
  const repo = state.repos[input.repoId]
  if (!repo) return { kind: 'target-missing' }
  if (repo.repoRuntimeId !== input.repoRuntimeId) return { kind: 'superseded' }
  const branchName = input.branchName
  const coordinatorTarget = {
    repoId: input.repoId,
    repoRuntimeId: input.repoRuntimeId,
    branchName,
    worktreePath: input.worktreePath,
  }
  const sourceRoute = input.sourceRoute
  const target = {
    repoRoot: input.repoId,
    repoRuntimeId: input.repoRuntimeId,
    branchName,
    worktreePath: input.worktreePath,
  }
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
  if (!committed.ok) return { kind: 'mutation-failed' }
  const liveTarget = resolveWorkspacePaneDestinationTarget(input.repoId, branchName)
  if (
    currentRepoRuntimeId(useReposStore.getState(), input.repoId) !== input.repoRuntimeId ||
    liveTarget.kind !== 'ready' ||
    liveTarget.lease.repoRuntimeId !== input.repoRuntimeId ||
    liveTarget.lease.worktreePath !== input.worktreePath
  ) {
    return { kind: 'superseded' }
  }
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(
      input.repoId,
      input.repoRuntimeId,
      branchName,
      workspacePaneStaticTabId(input.type),
      openerIdentity,
    )
  }
  if (provider.refreshOnOpen) {
    requestVisibleRepoProjectionRefresh(
      { get: useReposStore.getState, set: useReposStore.setState },
      input.repoId,
      branchName,
    )
  }
  if (transaction.kind === 'current' && !primaryWindowPresentationIsCurrent(transaction.presentationToken)) {
    return { kind: 'completed', changed: !alreadyOpen, presentation: 'superseded' }
  }
  if (transaction.kind === 'destination' && !workspacePaneDestinationPresentationIsCurrent(transaction.presentation)) {
    return { kind: 'completed', changed: !alreadyOpen, presentation: 'superseded' }
  }
  const navigationOutcome = await commitWorkspacePaneStaticTab(input, sourceRoute, transaction)
  if (!workspacePaneActionOutcomeSucceeded(navigationOutcome)) return navigationOutcome
  return navigationOutcome.kind === 'completed' ? { ...navigationOutcome, changed: !alreadyOpen } : navigationOutcome
}

async function commitWorkspacePaneStaticTab(
  input: {
    repoId: string
    repoRuntimeId: string
    branchName: string
    worktreePath: string | null
    type: WorkspacePaneStaticTabType
    navigation: WorkspacePaneTabControllerCommitNavigation
  },
  sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
  transaction: WorkspacePaneStaticTabRouteTransaction,
): Promise<WorkspacePaneActionOutcome> {
  const route = { kind: 'static' as const, tab: input.type }
  if (transaction.kind === 'destination') {
    return commitWorkspacePaneDestinationRoute(transaction.presentation, route, input.navigation)
  }
  const committed = await commitWorkspacePaneCurrentTargetRoute(
    {
      repoId: input.repoId,
      repoRuntimeId: input.repoRuntimeId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    },
    sourceRoute,
    route,
    input.navigation,
    undefined,
    transaction.presentationToken,
  )
  if (!committed && !primaryWindowPresentationIsCurrent(transaction.presentationToken)) {
    return { kind: 'completed', changed: true, presentation: 'superseded' }
  }
  return committed ? { kind: 'completed', changed: true, presentation: 'observed' } : { kind: 'navigation-rejected' }
}
