import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { requestVisibleRepoStatusRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneBranchViewType, WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import { isBranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'

export function openWorkspacePaneView(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType
  navigation: Pick<MainWindowNavigationActions, 'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'>
}): void {
  const branchLevelType = isBranchLevelWorkspacePaneView(input.type) ? input.type : null
  if (branchLevelType) {
    useReposStore.getState().openBranchWorkspacePaneView(input.repoId, branchLevelType, input.branchName)
  }
  if (input.worktreePath) {
    const worktreeKey = worktreeTerminalKey(input.repoId, input.worktreePath)
    void readTerminalSessionCommandBridge()?.openWorkspacePaneView(worktreeKey, input.type)
  } else if (!branchLevelType) {
    return
  }
  if (input.branchName) {
    input.navigation.showRepoBranchWorkspacePaneView(input.repoId, input.branchName, input.type)
  } else {
    input.navigation.showRepoWorkspacePaneView(input.repoId, input.type)
  }
  if (input.type === 'status' || input.type === 'changes') {
    requestVisibleRepoStatusRefresh(useReposStore.getState, input.repoId)
  }
}
