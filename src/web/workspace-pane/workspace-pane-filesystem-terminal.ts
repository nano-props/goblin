import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { showCreatedTerminalWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'

export function showCreatedWorkspacePaneFilesystemTerminal(
  target: WorkspacePaneFilesystemTarget,
  terminalSessionId: string,
  presentation: TerminalPresentation,
  navigation: PrimaryWindowNavigationActions,
): boolean | Promise<boolean> {
  if (target.kind === 'workspace-root') {
    if (presentation.kind !== 'workspace-root') return false
    const state = useReposStore.getState()
    state.setSelectedTerminal(formatTerminalWorktreeKeyForPath(target.workspaceId, target.rootPath), terminalSessionId)
    state.setWorkspacePaneTabForTarget(
      { kind: 'workspace-root', repoRoot: target.workspaceId },
      'terminal',
    )
    return true
  }
  if (presentation.kind !== 'git-worktree') return false
  const base = workspacePaneFilesystemTerminalBase(target)
  return base?.target.kind === 'git-worktree'
    ? showCreatedTerminalWorkspacePaneRuntimeTab({ target: base.target, presentation }, terminalSessionId, navigation)
    : false
}
