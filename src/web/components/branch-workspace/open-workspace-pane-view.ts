import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { requestVisibleRepoStatusRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

export async function openWorkspacePaneView(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticViewType
  navigation: Pick<MainWindowNavigationActions, 'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'>
}): Promise<boolean> {
  if (input.type === 'changes' && !input.worktreePath) return false
  useReposStore.getState().openWorkspacePaneStaticView(input.repoId, input.type, input.branchName)
  showWorkspacePaneView(input)
  if (input.type === 'status' || input.type === 'changes') requestVisibleRepoStatusRefresh(useReposStore.getState, input.repoId)
  return true
}

function showWorkspacePaneView(input: {
  repoId: string
  branchName?: string
  type: WorkspacePaneStaticViewType
  navigation: Pick<MainWindowNavigationActions, 'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'>
}): void {
  if (input.branchName) {
    input.navigation.showRepoBranchWorkspacePaneView(input.repoId, input.branchName, input.type)
  } else {
    input.navigation.showRepoWorkspacePaneView(input.repoId, input.type)
  }
}
