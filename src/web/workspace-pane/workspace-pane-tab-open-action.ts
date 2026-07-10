import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { requestVisibleRepoProjectionRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  commitWorkspacePaneControllerRoute,
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
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

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
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  type: WorkspacePaneStaticTabType
  insertAfterIdentity?: string | null
  navigation: WorkspacePaneTabControllerCommitNavigation
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
  return await runWorkspacePaneTabCoordinatorTask({ repoId, branchName }, async () => {
    const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
    if (resolution.kind !== 'ready') return false
    if (!resolution.target.branchName) return false
    return await openWorkspacePaneStaticTabAction({
      repoId,
      branchName: resolution.target.branchName,
      worktreePath: resolution.target.worktreePath,
      type,
      workspacePaneRoute,
      insertAfterIdentity,
      navigation,
    })
  })
}

export async function dispatchOpenWorkspacePaneStaticTabAction(
  input: OpenWorkspacePaneStaticTabActionOptions,
): Promise<boolean> {
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: input.repoId, branchName: input.branchName, worktreePath: input.worktreePath },
    () => openWorkspacePaneStaticTabAction(input),
  )
}

async function openWorkspacePaneStaticTabAction(input: OpenWorkspacePaneStaticTabActionOptions): Promise<boolean> {
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
  if (!repo) return false
  const branchName = input.branchName
  const target = {
    repoRoot: input.repoId,
    repoRuntimeId: repo.repoRuntimeId,
    branchName,
    worktreePath: input.worktreePath ?? null,
  }
  // Chrome-tab-style opener tracking: reopening/refocusing an already-open
  // static tab shouldn't overwrite its opener.
  const alreadyOpen = readWorkspacePaneTabsForTarget(target).some((entry) => entry.type === input.type)
  const openerIdentity = !alreadyOpen
    ? captureWorkspacePaneActiveTabIdentity(input.repoId, branchName, { workspacePaneRoute: input.workspacePaneRoute })
    : null
  // Default anchor is the captured opener; callers may pass null to force append.
  const insertAfterIdentity = input.insertAfterIdentity === undefined ? openerIdentity : input.insertAfterIdentity
  const committed = await updateWorkspacePaneTabs({
    ...target,
    repoRuntimeId: repo.repoRuntimeId,
    operation: {
      type: 'open-static',
      tabType: input.type,
      insertAfterIdentity,
    },
  })
  if (!committed.ok || !committed.projectionApplied) return false
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(input.repoId, branchName, workspacePaneStaticTabId(input.type), openerIdentity)
  }
  if (!(await commitWorkspacePaneStaticTab(input))) return false
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
  branchName: string
  type: WorkspacePaneStaticTabType
  navigation: WorkspacePaneTabControllerCommitNavigation
}): boolean | Promise<boolean> {
  return commitWorkspacePaneControllerRoute(
    input.repoId,
    input.branchName,
    { kind: 'static', tab: input.type },
    input.navigation,
  )
}
