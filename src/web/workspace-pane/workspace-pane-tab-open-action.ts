import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { currentWorkspaceRuntimeId } from '#/web/stores/workspaces/workspace-guards.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { requestVisibleWorkspaceStatusRefresh } from '#/web/stores/workspaces/repo-refresh-actions.ts'
import {
  commitWorkspacePaneCurrentTargetRoute,
  selectWorkspacePaneControllerTab,
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
  resolveWorkspacePaneTabTargetForBranch,
  resolveWorkspacePaneDestinationTarget,
  workspacePaneTabInteractionBlockedForBranch,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

export interface OpenWorkspacePaneTargetStaticTabActionOptions {
  workspaceId: string
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation
}

/** Opens and presents a static tab as one target-scoped transaction. */
export async function dispatchOpenWorkspacePaneTargetStaticTabAction(
  input: OpenWorkspacePaneTargetStaticTabActionOptions,
): Promise<WorkspacePaneActionOutcome> {
  const repo = useWorkspacesStore.getState().workspaces[input.workspaceId]
  if (!repo || input.paneTarget.repoRoot !== input.workspaceId) return { kind: 'target-missing' }
  const workspaceRuntimeId = repo.workspaceRuntimeId
  const worktreePath = workspacePaneTabsTargetWorktreePath(input.paneTarget)
  const branchName =
    input.paneTarget.kind === 'git-branch'
      ? input.paneTarget.branchName
      : input.worktreeHead?.kind === 'branch'
        ? input.worktreeHead.branchName
        : null
  const provider = workspacePaneStaticTabProvider(input.type)
  const hasFilesystemRoot = input.paneTarget.kind !== 'git-branch'
  if (!provider.canOpen({ hasWorktree: hasFilesystemRoot })) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  const presentationToken = beginPrimaryWindowPresentation()
  const actionTarget = workspacePaneActionTargetFromCoordinates({
    workspaceId: input.workspaceId,
    workspaceRuntimeId,
    branchName,
    worktreePath,
  })
  return await runWorkspacePaneAction(actionTarget, async () => {
    if (!primaryWindowPresentationIsCurrent(presentationToken)) return { kind: 'superseded' }
    const target = { ...input.paneTarget, workspaceRuntimeId }
    const currentTabs = readWorkspacePaneTabsForTarget(target)
    const alreadyOpen = currentTabs.some((entry) => entry.type === input.type)
    const openerIdentity = alreadyOpen
      ? null
      : captureWorkspacePaneActiveTabIdentity(input.paneTarget, workspaceRuntimeId, {
          workspacePaneRoute: input.workspacePaneRoute,
        })
    const committed = await updateWorkspacePaneTabs({
      ...target,
      operation: { type: 'open-static', tabType: input.type, insertAfterIdentity: null },
    })
    if (!committed.ok) return { kind: 'mutation-failed' }
    if (!committed.projectionApplied) return { kind: 'superseded' }
    const model = workspacePaneTabTargetForPaneTarget(input.paneTarget, input.workspacePaneRoute, input.worktreeHead)
    const tab = model?.tabs.find((candidate) => candidate.type === input.type)
    if (!model || !tab || !primaryWindowPresentationIsCurrent(presentationToken)) {
      return { kind: 'completed', changed: !alreadyOpen, presentation: 'superseded' }
    }
    if (openerIdentity) {
      recordWorkspacePaneTabOpener(
        input.paneTarget,
        workspaceRuntimeId,
        workspacePaneStaticTabId(input.type),
        openerIdentity,
      )
    }
    if (provider.refreshOnOpen && branchName) {
      void requestVisibleWorkspaceStatusRefresh(
        { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
        input.workspaceId,
        workspaceRuntimeId,
        branchName,
      )
    }
    const presented = await selectWorkspacePaneControllerTab(model, tab, input.navigation, presentationToken)
    return presented
      ? { kind: 'completed', changed: !alreadyOpen, presentation: 'observed' }
      : { kind: 'navigation-rejected' }
  })
}

export interface OpenWorkspacePaneStaticTabActionOptions {
  workspaceId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation
}

export interface ShowWorkspacePaneStaticTabActionOptions {
  workspaceId: string | null
  branchName: string | null
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  navigation: WorkspacePaneTabControllerCommitNavigation
}

type WorkspacePaneStaticTabPlacement =
  { kind: 'after-opener'; openerIdentity: string } | { kind: 'append'; openerIdentity: string | null }

type ResolvedOpenWorkspacePaneStaticTabActionOptions = Omit<
  OpenWorkspacePaneStaticTabActionOptions,
  'worktreePath' | 'workspacePaneRoute'
> & {
  workspaceRuntimeId: string
  worktreePath: string | null
  sourceRoute: ParsedWorkspacePaneRoute | null | undefined
  placement: WorkspacePaneStaticTabPlacement
}

export async function dispatchShowWorkspacePaneStaticTabAction({
  workspaceId,
  branchName,
  type,
  workspacePaneRoute,
  navigation,
}: ShowWorkspacePaneStaticTabActionOptions): Promise<WorkspacePaneActionOutcome> {
  if (!workspaceId || !branchName) return { kind: 'target-missing' }
  const resolution = resolveWorkspacePaneDestinationTarget(workspaceId, branchName)
  if (resolution.kind !== 'ready') return { kind: 'target-missing' }
  const lease = resolution.lease
  const provider = workspacePaneStaticTabProvider(type)
  if (!provider.canOpen({ hasWorktree: lease.worktreePath !== null })) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  const paneTarget = requiredGitWorkspacePaneTabsTarget(workspaceId, lease.branchName, lease.worktreePath)
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(paneTarget, lease.workspaceRuntimeId, {
    workspacePaneRoute,
  })
  const presentation = beginWorkspacePaneDestinationPresentation(lease)
  const input: ResolvedOpenWorkspacePaneStaticTabActionOptions = {
    workspaceId,
    workspaceRuntimeId: lease.workspaceRuntimeId,
    branchName: lease.branchName,
    worktreePath: lease.worktreePath,
    type,
    sourceRoute: workspacePaneRoute,
    placement: { kind: 'append', openerIdentity },
    navigation,
  }
  return await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: lease.repoId,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      branchName: lease.branchName,
      worktreePath: lease.worktreePath,
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
  const workspaceRuntimeId = currentWorkspaceRuntimeId(useWorkspacesStore.getState(), input.workspaceId)
  if (!workspaceRuntimeId) return false
  const sourceRoute = input.workspacePaneRoute
  const paneTarget = requiredGitWorkspacePaneTabsTarget(input.workspaceId, input.branchName, input.worktreePath ?? null)
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(paneTarget, workspaceRuntimeId, {
    workspacePaneRoute: sourceRoute,
  })
  const placement: WorkspacePaneStaticTabPlacement = openerIdentity
    ? { kind: 'after-opener', openerIdentity }
    : { kind: 'append', openerIdentity: null }
  const resolvedInput: ResolvedOpenWorkspacePaneStaticTabActionOptions = {
    workspaceId: input.workspaceId,
    workspaceRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath ?? null,
    type: input.type,
    sourceRoute,
    placement,
    navigation: input.navigation,
  }
  const presentationToken = beginPrimaryWindowPresentation()
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
    workspacePaneTabInteractionBlockedForBranch(input.workspaceId, input.branchName, {
      workspacePaneRoute: input.sourceRoute,
    })
  )
    return { kind: 'blocked' }
  const state = useWorkspacesStore.getState()
  const repo = state.workspaces[input.workspaceId]
  if (!repo) return { kind: 'target-missing' }
  if (repo.workspaceRuntimeId !== input.workspaceRuntimeId) return { kind: 'superseded' }
  const branchName = input.branchName
  const coordinatorTarget = {
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    branchName,
    worktreePath: input.worktreePath,
  }
  const sourceRoute = input.sourceRoute
  const target = {
    ...requiredGitWorkspacePaneTabsTarget(input.workspaceId, branchName, input.worktreePath),
    workspaceRuntimeId: input.workspaceRuntimeId,
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
  const liveTarget = resolveWorkspacePaneDestinationTarget(input.workspaceId, branchName)
  if (
    currentWorkspaceRuntimeId(useWorkspacesStore.getState(), input.workspaceId) !== input.workspaceRuntimeId ||
    liveTarget.kind !== 'ready' ||
    liveTarget.lease.workspaceRuntimeId !== input.workspaceRuntimeId ||
    liveTarget.lease.worktreePath !== input.worktreePath
  ) {
    return { kind: 'superseded' }
  }
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(target, input.workspaceRuntimeId, workspacePaneStaticTabId(input.type), openerIdentity)
  }
  if (provider.refreshOnOpen) requestVisibleStatusRefreshOnOpen(input)
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

function requestVisibleStatusRefreshOnOpen(input: ResolvedOpenWorkspacePaneStaticTabActionOptions): void {
  void requestVisibleWorkspaceStatusRefresh(
    { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
    input.workspaceId,
    input.workspaceRuntimeId,
    input.branchName,
  )
}

async function commitWorkspacePaneStaticTab(
  input: {
    workspaceId: string
    workspaceRuntimeId: string
    branchName: string
    worktreePath: string | null
    type: WorkspacePaneStaticTabType
    navigation: WorkspacePaneTabControllerCommitNavigation
  },
  sourceRoute: ParsedWorkspacePaneRoute | null | undefined,
  transaction: WorkspacePaneStaticTabRouteTransaction,
): Promise<WorkspacePaneActionOutcome> {
  const route = { kind: 'static' as const, tab: input.type }
  if (transaction.kind === 'destination') {
    return commitWorkspacePaneDestinationRoute(transaction.presentation, route, input.navigation)
  }
  const committed = await commitWorkspacePaneCurrentTargetRoute(
    {
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      paneTarget: requiredGitWorkspacePaneTabsTarget(input.workspaceId, input.branchName, input.worktreePath),
    },
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
