import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { requestVisibleRepoStatusRefresh } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneBranchViewType, WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneWorktreeStaticViewType } from '#/shared/workspace-pane.ts'
import { isBranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import { terminalLog } from '#/web/logger.ts'

export async function openWorkspacePaneView(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType
  navigation: Pick<MainWindowNavigationActions, 'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'>
}): Promise<boolean> {
  const branchLevelType = isBranchLevelWorkspacePaneView(input.type) ? input.type : null
  if (branchLevelType) {
    useReposStore.getState().openBranchWorkspacePaneView(input.repoId, branchLevelType, input.branchName)
    showWorkspacePaneView(input)
    if (input.type === 'status') requestVisibleRepoStatusRefresh(useReposStore.getState, input.repoId)
    return true
  }

  if (input.worktreePath && isWorkspacePaneWorktreeStaticViewType(input.type)) {
    const bridge = readTerminalSessionCommandBridge()
    if (!bridge) return false
    const worktreeKey = worktreeTerminalKey(input.repoId, input.worktreePath)
    const opened = await bridge.openWorkspacePaneView(worktreeKey, input.type).catch((err) => {
      terminalLog.warn('failed to open workspace pane view', { err, type: input.type, worktreeKey })
      return false
    })
    if (!opened) return false
    showWorkspacePaneView(input)
    requestVisibleRepoStatusRefresh(useReposStore.getState, input.repoId)
    return true
  }

  return false
}

function showWorkspacePaneView(input: {
  repoId: string
  branchName?: string
  type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType
  navigation: Pick<MainWindowNavigationActions, 'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'>
}): void {
  if (input.branchName) {
    input.navigation.showRepoBranchWorkspacePaneView(input.repoId, input.branchName, input.type)
  } else {
    input.navigation.showRepoWorkspacePaneView(input.repoId, input.type)
  }
}
