import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { requestVisibleRepoProjectionRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { workspacePaneTabInteractionBlockedForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

export async function openWorkspacePaneTab(input: {
  repoId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  insertAfterIdentity?: string | null
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'>
}): Promise<boolean> {
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
  if (!committed.ok) return false
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(input.repoId, branchName, workspacePaneStaticTabId(input.type), openerIdentity)
  }
  if (!showWorkspacePaneTab(input)) return false
  if (provider.refreshOnOpen) {
    requestVisibleRepoProjectionRefresh({ get: useReposStore.getState, set: useReposStore.setState }, input.repoId, branchName)
  }
  return true
}

function showWorkspacePaneTab(input: {
  repoId: string
  branchName: string
  type: WorkspacePaneStaticTabType
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'>
}): boolean {
  return input.navigation.showRepoBranchWorkspacePaneTab(input.repoId, input.branchName, input.type)
}
