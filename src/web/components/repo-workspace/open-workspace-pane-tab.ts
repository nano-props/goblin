import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { requestVisibleRepoStatusRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import { commitWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { workspacePaneTabsWithStaticTab } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { fetchWorkspacePaneTabsForBranch } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export async function openWorkspacePaneTab(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab' | 'showRepoWorkspacePaneTab'>
}): Promise<boolean> {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) return false
  const repo = useReposStore.getState().repos[input.repoId]
  if (!repo) return false
  const branchName = input.branchName ?? repo?.ui.selectedBranch
  if (branchName) {
    const currentTabs = await fetchWorkspacePaneTabsForBranch({ repoRoot: input.repoId, branchName })
    const committed = await commitWorkspacePaneTabs({
      repoRoot: input.repoId,
      branchName,
      worktreePath: input.worktreePath ?? null,
      tabs: workspacePaneTabsWithStaticTab(currentTabs, input.type),
    })
    if (!committed) return false
  }
  showWorkspacePaneTab(input)
  if (provider.refreshOnOpen) requestVisibleRepoStatusRefresh(useReposStore.getState, input.repoId)
  return true
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
