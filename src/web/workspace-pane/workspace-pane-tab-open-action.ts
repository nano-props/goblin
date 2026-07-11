import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import {
  workspacePaneStaticTabId,
  workspacePaneTabEntryIdentity,
  type WorkspacePaneStaticTabType,
} from '#/shared/workspace-pane.ts'
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
  workspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  resolveWorkspacePaneDestinationTarget,
  workspacePaneTabInteractionBlockedForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  runWorkspacePaneTabCoordinatorTask,
  workspacePaneTabCoordinatorObservedRoute,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
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
  insertAfterIdentity?: string | null
  navigation: WorkspacePaneTabControllerCommitNavigation
}

export interface ShowWorkspacePaneStaticTabActionOptions {
  repoId: string | null
  branchName: string | null
  type: WorkspacePaneStaticTabType
  insertAfterIdentity?: string | null
  navigation: WorkspacePaneTabControllerCommitNavigation
}

type ResolvedOpenWorkspacePaneStaticTabActionOptions = Omit<OpenWorkspacePaneStaticTabActionOptions, 'worktreePath'> & {
  repoRuntimeId: string
  worktreePath: string | null
}

export async function dispatchShowWorkspacePaneStaticTabAction({
  repoId,
  branchName,
  type,
  insertAfterIdentity,
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
  const presentation = beginWorkspacePaneDestinationPresentation(lease)
  const input: ResolvedOpenWorkspacePaneStaticTabActionOptions = {
    repoId,
    repoRuntimeId: lease.repoRuntimeId,
    branchName: lease.branchName,
    worktreePath: lease.worktreePath,
    type,
    workspacePaneRoute: undefined,
    insertAfterIdentity,
    navigation,
  }
  return await runWorkspacePaneTabCoordinatorTask(lease, () =>
    openWorkspacePaneStaticTabAction(input, {
      kind: 'destination',
      presentation,
      sourceRoute: workspacePaneTabCoordinatorObservedRoute(lease),
    }),
  )
}

export async function dispatchOpenWorkspacePaneStaticTabAction(
  input: OpenWorkspacePaneStaticTabActionOptions,
): Promise<boolean> {
  const repoRuntimeId = currentRepoRuntimeId(useReposStore.getState(), input.repoId)
  if (!repoRuntimeId) return false
  const resolvedInput: ResolvedOpenWorkspacePaneStaticTabActionOptions = {
    ...input,
    repoRuntimeId,
    worktreePath: input.worktreePath ?? null,
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
        sourceRoute:
          workspacePaneTabCoordinatorObservedRoute({
            repoId: input.repoId,
            repoRuntimeId,
            branchName: input.branchName,
            worktreePath: resolvedInput.worktreePath,
          }) ?? input.workspacePaneRoute,
      }),
  )
  return workspacePaneActionOutcomeSucceeded(outcome)
}

type WorkspacePaneStaticTabRouteTransaction =
  | {
      kind: 'current'
      presentationToken: PrimaryWindowPresentationToken
      sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
    }
  | {
      kind: 'destination'
      presentation: WorkspacePaneDestinationPresentation
      sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
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
      workspacePaneRoute: input.workspacePaneRoute,
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
  const sourceRoute = transaction.sourceRoute
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
  const openerIdentity = !alreadyOpen
    ? captureWorkspacePaneActiveTabIdentity(input.repoId, input.repoRuntimeId, branchName, {
        workspacePaneRoute: sourceRoute,
      })
    : null
  // Default anchor is the captured opener; callers may pass null to force append.
  let invocationOrderedInsertAfterIdentity = openerIdentity
  if (openerIdentity) {
    for (const entry of currentTabs) {
      const identity = workspacePaneTabEntryIdentity(entry)
      if (workspacePaneTabOpener(input.repoId, input.repoRuntimeId, branchName, identity) === openerIdentity) {
        invocationOrderedInsertAfterIdentity = identity
      }
    }
  }
  const insertAfterIdentity =
    input.insertAfterIdentity === undefined ? invocationOrderedInsertAfterIdentity : input.insertAfterIdentity
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
  return navigationOutcome.kind === 'completed'
    ? { ...navigationOutcome, changed: !alreadyOpen }
    : navigationOutcome
}

async function commitWorkspacePaneStaticTab(input: {
  repoId: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  type: WorkspacePaneStaticTabType
  navigation: WorkspacePaneTabControllerCommitNavigation
}, sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined, transaction: WorkspacePaneStaticTabRouteTransaction): Promise<WorkspacePaneActionOutcome> {
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
  return committed
    ? { kind: 'completed', changed: true, presentation: 'observed' }
    : { kind: 'navigation-rejected' }
}
