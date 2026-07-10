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
import { commitWorkspacePaneDestinationRoute } from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  resolveWorkspacePaneDestinationTarget,
  resolveWorkspacePaneDestinationTargetLease,
  workspacePaneDestinationTargetLeaseIsCurrent,
  type WorkspacePaneDestinationTargetLease,
  workspacePaneTabInteractionBlockedForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  runWorkspacePaneTabCoordinatorTask,
  workspacePaneTabCoordinatorObservedRoute,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

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
}: ShowWorkspacePaneStaticTabActionOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  const resolution = resolveWorkspacePaneDestinationTarget(repoId, branchName)
  if (resolution.kind === 'no-worktree') return false
  if (resolution.kind !== 'ready') return false
  const lease = resolution.lease
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
      lease,
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
  return await runWorkspacePaneTabCoordinatorTask(
    {
      repoId: input.repoId,
      repoRuntimeId,
      branchName: input.branchName,
      worktreePath: resolvedInput.worktreePath,
    },
    () =>
      openWorkspacePaneStaticTabAction(resolvedInput, {
        kind: 'current',
        sourceRoute:
          workspacePaneTabCoordinatorObservedRoute({
            repoId: input.repoId,
            repoRuntimeId,
            branchName: input.branchName,
            worktreePath: resolvedInput.worktreePath,
          }) ?? input.workspacePaneRoute,
      }),
  )
}

type WorkspacePaneStaticTabRouteTransaction =
  | {
      kind: 'current'
      sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
    }
  | {
      kind: 'destination'
      lease: WorkspacePaneDestinationTargetLease
      sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
    }

async function openWorkspacePaneStaticTabAction(
  input: ResolvedOpenWorkspacePaneStaticTabActionOptions,
  transaction: WorkspacePaneStaticTabRouteTransaction,
): Promise<boolean> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) return false
  if (
    transaction.kind === 'current' &&
    workspacePaneTabInteractionBlockedForBranch(input.repoId, input.branchName, {
      workspacePaneRoute: input.workspacePaneRoute,
    })
  )
    return false
  const state = useReposStore.getState()
  const repo = state.repos[input.repoId]
  if (!repo || repo.repoRuntimeId !== input.repoRuntimeId) return false
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
  const alreadyOpen = readWorkspacePaneTabsForTarget(target).some((entry) => entry.type === input.type)
  const openerIdentity = !alreadyOpen
    ? captureWorkspacePaneActiveTabIdentity(input.repoId, input.repoRuntimeId, branchName, {
        workspacePaneRoute: sourceRoute,
      })
    : null
  // Default anchor is the captured opener; callers may pass null to force append.
  const insertAfterIdentity = input.insertAfterIdentity === undefined ? openerIdentity : input.insertAfterIdentity
  const committed = await updateWorkspacePaneTabs({
    ...target,
    operation: {
      type: 'open-static',
      tabType: input.type,
      insertAfterIdentity,
    },
  })
  if (!committed.ok) return false
  if (currentRepoRuntimeId(useReposStore.getState(), input.repoId) !== input.repoRuntimeId) return false
  if (transaction.kind === 'destination' && !workspacePaneDestinationTargetLeaseIsCurrent(transaction.lease)) {
    return false
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
  if (!(await commitWorkspacePaneStaticTab(input, sourceRoute, transaction))) return false
  if (provider.refreshOnOpen) {
    requestVisibleRepoProjectionRefresh(
      { get: useReposStore.getState, set: useReposStore.setState },
      input.repoId,
      branchName,
    )
  }
  return true
}

function commitWorkspacePaneStaticTab(input: {
  repoId: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  type: WorkspacePaneStaticTabType
  navigation: WorkspacePaneTabControllerCommitNavigation
}, sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined, transaction: WorkspacePaneStaticTabRouteTransaction): Promise<boolean> {
  const route = { kind: 'static' as const, tab: input.type }
  if (transaction.kind === 'destination') {
    return commitWorkspacePaneDestinationRoute(transaction.lease, route, input.navigation)
  }
  return commitWorkspacePaneCurrentTargetRoute(
    {
      repoId: input.repoId,
      repoRuntimeId: input.repoRuntimeId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    },
    sourceRoute,
    route,
    input.navigation,
  )
}
