import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { requestVisibleRepoStatusRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { hasFreshRepoInstance, repoInstanceHandle, type RepoInstanceHandle } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  recordWorkspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

export async function openWorkspacePaneTab(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  insertAfterTabType?: WorkspacePaneStaticTabType
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab' | 'showRepoWorkspacePaneTab'>
}): Promise<boolean> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) return false
  const state = useReposStore.getState()
  const repo = state.repos[input.repoId]
  if (!repo) return false
  const repoInstance = repoInstanceHandle(repo)
  const initialActiveId = state.activeId
  const initialSelectedBranch = repo.ui.selectedBranch
  const branchName = input.branchName ?? repo?.ui.selectedBranch
  if (branchName) {
    const target = {
      repoRoot: input.repoId,
      repoInstanceId: repo.instanceId,
      branchName,
      worktreePath: input.worktreePath ?? null,
    }
    // Chrome-tab-style opener tracking: only meaningful when we're opening a
    // tab into the tab strip the user is *currently looking at* (their
    // selected branch) and the tab doesn't already exist — reopening/
    // refocusing an already-open static tab shouldn't overwrite its opener.
    const isVisibleTabStrip = branchName === repo.ui.selectedBranch
    const alreadyOpen = readWorkspacePaneTabsForTarget(target).some((entry) => entry.type === input.type)
    const openerIdentity =
      isVisibleTabStrip && !alreadyOpen ? captureWorkspacePaneActiveTabIdentity(input.repoId) : null
    const committed = await updateWorkspacePaneTabs({
      ...target,
      repoInstanceId: repo.instanceId,
      operation: {
        type: 'open-static',
        tabType: input.type,
        insertAfterTabType: input.insertAfterTabType,
      },
    })
    if (!committed.ok) return false
    if (openerIdentity) {
      recordWorkspacePaneTabOpener(
        input.repoId,
        branchName,
        workspacePaneStaticTabId(input.type),
        openerIdentity,
        repoInstance,
      )
    }
  }
  if (shouldSelectOpenedWorkspacePaneTab(repoInstance, initialActiveId, initialSelectedBranch)) {
    showWorkspacePaneTab(input)
  }
  if (provider.refreshOnOpen) requestVisibleRepoStatusRefresh(useReposStore.getState, input.repoId)
  return true
}

function shouldSelectOpenedWorkspacePaneTab(
  repoInstance: RepoInstanceHandle | null,
  initialActiveId: string | null,
  initialSelectedBranch: string | null,
): boolean {
  const state = useReposStore.getState()
  if (!hasFreshRepoInstance(state, repoInstance)) return false
  if (!repoInstance) return false
  return state.activeId === initialActiveId && state.repos[repoInstance.id]?.ui.selectedBranch === initialSelectedBranch
}

function showWorkspacePaneTab(input: {
  repoId: string
  branchName?: string
  type: WorkspacePaneStaticTabType
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab' | 'showRepoWorkspacePaneTab'>
}): void {
  if (input.branchName) {
    input.navigation.showRepoBranchWorkspacePaneTab(input.repoId, input.branchName, input.type)
  } else {
    input.navigation.showRepoWorkspacePaneTab(input.repoId, input.type)
  }
}
