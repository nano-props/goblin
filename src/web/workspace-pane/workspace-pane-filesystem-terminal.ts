import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import {
  showCreatedTerminalWorkspacePaneRuntimeTab,
  type CreatedTerminalRouteRequest,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { FilesystemWorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

export function showCreatedWorkspacePaneFilesystemTerminal(
  location: FilesystemWorkspacePaneLocation,
  terminalSessionId: string,
  presentation: TerminalPresentation,
  navigation: AppNavigationActions,
  routeRequest: CreatedTerminalRouteRequest,
): boolean | Promise<boolean> {
  return showCreatedTerminalWorkspacePaneRuntimeTab(location, presentation, terminalSessionId, navigation, routeRequest)
}
