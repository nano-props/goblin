import { onScopeDispose, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { useTerminalSessionProjection } from '#/web/components/terminal/use-terminal-session-projection.ts'
import { runRetiredTerminalWorkspacePaneTabPresentationCommand } from '#/web/commands/workspace-commands.ts'
import { terminalLog } from '#/web/logger.ts'

export function useTerminalRetirementWorkspacePanePresentation(input: {
  currentTarget: MaybeRefOrGetter<WorkspacePaneCommandTarget | null>
  navigation: MaybeRefOrGetter<AppNavigationActions>
}): void {
  const projection = useTerminalSessionProjection()

  const unsubscribe = projection.subscribeAcceptedRetirement((retirement) => {
    const currentTarget = toValue(input.currentTarget)
    if (!currentTarget) return
    void runRetiredTerminalWorkspacePaneTabPresentationCommand({
      target: currentTarget,
      navigation: toValue(input.navigation),
      terminalSessionId: retirement.terminalSessionId,
      tabsBeforeRetirement: retirement.tabsBeforeRetirement,
    }).catch((err: unknown) => {
      terminalLog.warn('failed to present retired terminal close-back', {
        terminalSessionId: retirement.terminalSessionId,
        err,
      })
    })
  })
  onScopeDispose(unsubscribe)
}
