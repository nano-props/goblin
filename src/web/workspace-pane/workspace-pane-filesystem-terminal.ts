import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { showCreatedTerminalWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

export function showCreatedWorkspacePaneFilesystemTerminal(
  target: WorkspacePaneFilesystemTarget,
  terminalSessionId: string,
  canonicalBranch: string,
  navigation: PrimaryWindowNavigationActions,
): boolean | Promise<boolean> {
  if (target.kind === 'workspace-root') {
    const state = useReposStore.getState()
    state.setSelectedTerminal(formatTerminalWorktreeKey(target.workspaceId, target.rootPath), terminalSessionId)
    state.setWorkspacePaneTabForTarget(
      { kind: 'workspace-root', repoRoot: target.workspaceId, branchName: null, worktreePath: null },
      'terminal',
    )
    return true
  }
  const base = workspacePaneFilesystemTerminalBase(target)
  return base
    ? showCreatedTerminalWorkspacePaneRuntimeTab({ ...base, branch: canonicalBranch }, terminalSessionId, navigation)
    : false
}
