import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

export function openWorkspacePaneView(input: {
  repoId: string
  branchName?: string
  worktreePath: string | null | undefined
  type: WorkspacePaneStaticViewType
  navigation: Pick<MainWindowNavigationActions, 'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'>
  setDetailCollapsed: (collapsed: boolean) => void
}): void {
  if (!input.worktreePath) return
  const worktreeKey = worktreeTerminalKey(input.repoId, input.worktreePath)
  void readTerminalSessionCommandBridge()?.openWorkspacePaneView(worktreeKey, input.type)
  if (input.branchName) {
    input.navigation.showRepoBranchWorkspacePaneView(input.repoId, input.branchName, input.type)
  } else {
    input.navigation.showRepoWorkspacePaneView(input.repoId, input.type)
  }
  input.setDetailCollapsed(false)
}
