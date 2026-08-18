import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { isWorkspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { FilesystemWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { appNavigationIsCurrent, beginAppNavigation } from '#/web/app/navigation/lifecycle.ts'
import { tryRunWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  workspacePaneLocationTerminalBaseMatches,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export function commitWorkspacePaneTerminalDestination(input: {
  location: FilesystemWorkspacePaneLocation
  base: TerminalSessionBase
  terminalSessionId: string
  navigation: AppNavigationActions
}): Promise<WorkspacePaneActionOutcome> {
  if (!workspacePaneLocationTerminalBaseMatches(input.location, input.base)) {
    return Promise.resolve({ kind: 'target-missing' })
  }
  return commitFilesystemTerminalDestination({
    navigation: input.navigation,
    location: input.location,
    terminalSessionId: input.terminalSessionId,
  })
}

function terminalPaneProjectionOutcome(
  paneTarget: FilesystemWorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  terminalSessionId: string,
): { kind: 'blocked' } | { kind: 'target-missing' } | null {
  const projection = readWorkspacePaneTabsProjectionForTarget({ ...paneTarget, workspaceRuntimeId })
  if (projection.phase !== 'ready') return { kind: 'blocked' }
  return projection.tabs.some(
    (tab) => isWorkspacePaneRuntimeTabEntry(tab) && tab.runtimeSessionId === terminalSessionId,
  )
    ? null
    : { kind: 'target-missing' }
}

async function commitFilesystemTerminalDestination(input: {
  navigation: AppNavigationActions
  location: FilesystemWorkspacePaneLocation
  terminalSessionId: string
}): Promise<WorkspacePaneActionOutcome> {
  return await commitQueuedTerminalDestination(input.location, async () => {
    const projectionOutcome = terminalPaneProjectionOutcome(
      input.location.paneTarget,
      input.location.workspaceRuntimeId,
      input.terminalSessionId,
    )
    if (projectionOutcome) return projectionOutcome
    const navigationGeneration = beginAppNavigation()
    const committed = await input.navigation.commitFilesystemWorkspacePaneRoute(
      input.location,
      {
        kind: 'terminal',
        terminalSessionId: input.terminalSessionId,
      },
      { navigationGeneration },
    )
    return committed
      ? { kind: 'completed', changed: true, presentation: 'router-settled' }
      : appNavigationIsCurrent(navigationGeneration)
        ? { kind: 'navigation-rejected' }
        : { kind: 'superseded' }
  })
}

async function commitQueuedTerminalDestination(
  location: FilesystemWorkspacePaneLocation,
  commit: () => Promise<WorkspacePaneActionOutcome> | WorkspacePaneActionOutcome,
): Promise<WorkspacePaneActionOutcome> {
  const admission = await tryRunWorkspacePaneAction(location, commit)
  return admission.kind === 'busy' ? { kind: 'blocked' } : admission.result
}
