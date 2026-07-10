import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { requestVisibleRepoProjectionRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { currentRepoRuntimeId } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  commitWorkspacePaneControllerTargetRoute,
  type WorkspacePaneControllerTransactionPolicy,
  WORKSPACE_PANE_CURRENT_TARGET_LEASE,
  WORKSPACE_PANE_DESTINATION_TARGET_NAVIGATION,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
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
  presentationPolicy?: WorkspacePaneControllerTransactionPolicy
}

export interface ShowWorkspacePaneStaticTabActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
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
  workspacePaneRoute,
  type,
  insertAfterIdentity,
  navigation,
}: ShowWorkspacePaneStaticTabActionOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  if (resolution.kind !== 'ready') return false
  if (!resolution.target.branchName) return false
  return await dispatchOpenWorkspacePaneStaticTabAction({
    repoId,
    branchName: resolution.target.branchName,
    worktreePath: resolution.target.worktreePath,
    type,
    workspacePaneRoute,
    insertAfterIdentity,
    navigation,
    presentationPolicy: WORKSPACE_PANE_DESTINATION_TARGET_NAVIGATION,
  })
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
    () => openWorkspacePaneStaticTabAction(resolvedInput),
  )
}

async function openWorkspacePaneStaticTabAction(
  input: ResolvedOpenWorkspacePaneStaticTabActionOptions,
): Promise<boolean> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) return false
  if (
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
  const sourceRoute = workspacePaneTabCoordinatorObservedRoute(coordinatorTarget) ?? input.workspacePaneRoute
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
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(
      input.repoId,
      input.repoRuntimeId,
      branchName,
      workspacePaneStaticTabId(input.type),
      openerIdentity,
    )
  }
  if (!(await commitWorkspacePaneStaticTab(input, sourceRoute))) return false
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
  presentationPolicy?: WorkspacePaneControllerTransactionPolicy
}, sourceRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined): Promise<boolean> {
  return commitWorkspacePaneControllerTargetRoute(
    {
      repoId: input.repoId,
      repoRuntimeId: input.repoRuntimeId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
    },
    sourceRoute,
    { kind: 'static', tab: input.type },
    input.navigation,
    input.presentationPolicy ?? WORKSPACE_PANE_CURRENT_TARGET_LEASE,
  )
}
