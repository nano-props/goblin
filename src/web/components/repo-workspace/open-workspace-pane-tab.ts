import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { requestVisibleRepoStatusRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'

export function openWorkspacePaneTab(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticTabType
  navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab' | 'showRepoWorkspacePaneTab'>
}): boolean {
  const provider = workspacePaneStaticTabProvider(input.type)
  if (!provider.canOpen({ hasWorktree: !!input.worktreePath })) return false
  useReposStore.getState().openWorkspacePaneStaticTab(input.repoId, input.type, input.branchName)
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
