import { useEffect } from 'react'
import type { AppNavigationActions } from '#/web/app-navigation.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { runRetiredTerminalWorkspacePaneTabPresentationCommand } from '#/web/commands/workspace-commands.ts'
import { terminalLog } from '#/web/logger.ts'

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentTarget: WorkspacePaneCommandTarget | null
  navigation: AppNavigationActions
}): void {
  const { currentTarget, navigation } = input
  const projection = useTerminalSessionProjection()

  useEffect(
    () =>
      projection.subscribeAcceptedRetirement((retirement) => {
        if (!currentTarget) return
        void runRetiredTerminalWorkspacePaneTabPresentationCommand({
          target: currentTarget,
          navigation,
          terminalSessionId: retirement.terminalSessionId,
          tabsBeforeRetirement: retirement.tabsBeforeRetirement,
        }).catch((err: unknown) => {
          terminalLog.warn('failed to present retired terminal close-back', {
            terminalSessionId: retirement.terminalSessionId,
            err,
          })
        })
      }),
    [currentTarget, navigation, projection],
  )
}
