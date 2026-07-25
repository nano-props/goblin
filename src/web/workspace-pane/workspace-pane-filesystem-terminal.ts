import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  showCreatedTerminalWorkspacePaneRuntimeTab,
  type CreatedTerminalRouteRequest,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'

export function showCreatedWorkspacePaneFilesystemTerminal(
  target: WorkspacePaneFilesystemTarget,
  terminalSessionId: string,
  presentation: TerminalPresentation,
  navigation: PrimaryWindowNavigationActions,
  routeRequest: CreatedTerminalRouteRequest,
): boolean | Promise<boolean> {
  const base = workspacePaneFilesystemTerminalBase(target)
  if (!base || base.target.kind !== presentation.kind) return false
  if (base.target.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
    return showCreatedTerminalWorkspacePaneRuntimeTab(
      { target: base.target, presentation },
      terminalSessionId,
      navigation,
      routeRequest,
    )
  }
  if (base.target.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
    return showCreatedTerminalWorkspacePaneRuntimeTab(
      { target: base.target, presentation },
      terminalSessionId,
      navigation,
      routeRequest,
    )
  }
  return false
}
