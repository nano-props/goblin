import { useEffect } from 'react'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import { runRetiredTerminalWorkspacePaneTabPresentationCommand } from '#/web/commands/workspace-commands.ts'
import { terminalLog } from '#/web/logger.ts'

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentWorkspaceId: WorkspaceId | null
  currentTarget: WorkspacePaneCommandTarget | null
  navigation: PrimaryWindowNavigationActions
}): void {
  const { currentWorkspaceId, currentTarget, navigation } = input
  const projection = useTerminalSessionProjection()

  useEffect(
    () =>
      projection.subscribeAcceptedRetirement((retirement) => {
        if (!currentWorkspaceId || !currentTarget) return
        const presentation = retirement.retirementPresentation
        const coordinates = terminalSessionCoordinates(presentation.terminalBase)
        const workspace = currentWorkspaceId === coordinates.workspaceId ? currentWorkspaceId : null
        if (!workspace) return
        void runRetiredTerminalWorkspacePaneTabPresentationCommand({
          workspaceId: workspace,
          target: currentTarget,
          navigation,
          terminalSessionId: retirement.terminalSessionId,
          retirementPresentation: presentation,
        }).catch((err: unknown) => {
          terminalLog.warn('failed to present retired terminal close-back', {
            terminalSessionId: retirement.terminalSessionId,
            err,
          })
        })
      }),
    [currentTarget, currentWorkspaceId, navigation, projection],
  )
}
