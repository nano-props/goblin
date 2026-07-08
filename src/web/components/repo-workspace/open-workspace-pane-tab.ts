import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { requestVisibleRepoProjectionRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { hasFreshRepoInstance, repoInstanceHandle } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

export async function openWorkspacePaneTab(input: {
  repoId: string
  branchName: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  insertAfterIdentity?: string | null
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'>
}): Promise<boolean> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) return false
  const state = useReposStore.getState()
  const repo = state.repos[input.repoId]
  if (!repo) return false
  const repoInstance = repoInstanceHandle(repo)
  const branchName = input.branchName
  const target = {
    repoRoot: input.repoId,
    repoInstanceId: repo.instanceId,
    branchName,
    worktreePath: input.worktreePath ?? null,
  }
  // Chrome-tab-style opener tracking: reopening/refocusing an already-open
  // static tab shouldn't overwrite its opener.
  const alreadyOpen = readWorkspacePaneTabsForTarget(target).some((entry) => entry.type === input.type)
  const openerIdentity = !alreadyOpen ? captureWorkspacePaneActiveTabIdentity(input.repoId, branchName) : null
  // Default anchor is the captured opener; callers may pass null to force append.
  const insertAfterIdentity = input.insertAfterIdentity === undefined ? openerIdentity : input.insertAfterIdentity
  const committed = await updateWorkspacePaneTabs({
    ...target,
    repoInstanceId: repo.instanceId,
    operation: {
      type: 'open-static',
      tabType: input.type,
      insertAfterIdentity,
    },
  })
  if (!committed.ok) return false
  if (!hasFreshRepoInstance(useReposStore.getState(), repoInstance)) return false
  if (openerIdentity) {
    recordWorkspacePaneTabOpener(
      input.repoId,
      branchName,
      workspacePaneStaticTabId(input.type),
      openerIdentity,
      repoInstance,
    )
  }
  showWorkspacePaneTab(input)
  if (provider.refreshOnOpen) requestVisibleRepoProjectionRefresh(useReposStore.getState, input.repoId, branchName)
  return true
}

function showWorkspacePaneTab(input: {
  repoId: string
  branchName: string
  type: WorkspacePaneStaticTabType
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'>
}): void {
  input.navigation.showRepoBranchWorkspacePaneTab(input.repoId, input.branchName, input.type)
}
