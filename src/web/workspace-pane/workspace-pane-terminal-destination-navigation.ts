import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { workspacePaneFilesystemExecutionTargetKey } from '#/shared/workspace-runtime.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { isWorkspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { FilesystemWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { appNavigationIsCurrent, beginAppNavigation } from '#/web/app/navigation/lifecycle.ts'
import {
  tryRunWorkspacePaneAction,
  workspacePaneActionTargetFromLocation,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  filesystemWorkspacePaneTargetLeaseForLocation,
  type FilesystemWorkspacePaneTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneLocationTerminalBase,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export function commitWorkspacePaneTerminalDestination(input: {
  location: FilesystemWorkspacePaneLocation
  base: TerminalSessionBase
  terminalSessionId: string
  navigation: AppNavigationActions
}): Promise<WorkspacePaneActionOutcome> {
  const expectedBase = workspacePaneLocationTerminalBase(input.location)
  if (!expectedBase || !terminalBasesEqual(expectedBase, input.base)) {
    return Promise.resolve({ kind: 'target-missing' })
  }
  return commitFilesystemTerminalDestination({
    navigation: input.navigation,
    target: filesystemWorkspacePaneTargetLeaseForLocation(input.location),
    paneTarget: input.location.paneTarget,
    actionTarget: workspacePaneActionTargetFromLocation(input.location),
    terminalSessionId: input.terminalSessionId,
  })
}

function terminalBasesEqual(left: TerminalSessionBase, right: TerminalSessionBase): boolean {
  return (
    left.presentation.kind === right.presentation.kind &&
    workspacePaneFilesystemExecutionTargetKey(left.target) === workspacePaneFilesystemExecutionTargetKey(right.target)
  )
}

function terminalPaneProjectionOutcome(
  target: FilesystemWorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  terminalSessionId: string,
): { kind: 'blocked' } | { kind: 'target-missing' } | null {
  const projection = readWorkspacePaneTabsProjectionForTarget({ ...target, workspaceRuntimeId })
  if (projection.phase !== 'ready') return { kind: 'blocked' }
  return projection.tabs.some(
    (tab) => isWorkspacePaneRuntimeTabEntry(tab) && tab.runtimeSessionId === terminalSessionId,
  )
    ? null
    : { kind: 'target-missing' }
}

async function commitFilesystemTerminalDestination(input: {
  navigation: AppNavigationActions
  target: FilesystemWorkspacePaneTargetLease
  paneTarget: FilesystemWorkspacePaneTabsTarget
  actionTarget: WorkspacePaneActionTarget
  terminalSessionId: string
}): Promise<WorkspacePaneActionOutcome> {
  return await commitQueuedTerminalDestination(input.actionTarget, async () => {
    const projectionOutcome = terminalPaneProjectionOutcome(
      input.paneTarget,
      input.target.workspaceRuntimeId,
      input.terminalSessionId,
    )
    if (projectionOutcome) return projectionOutcome
    const navigationGeneration = beginAppNavigation()
    const committed = await input.navigation.commitFilesystemWorkspacePaneRoute(
      input.target,
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
  actionTarget: WorkspacePaneActionTarget,
  commit: () => Promise<WorkspacePaneActionOutcome> | WorkspacePaneActionOutcome,
): Promise<WorkspacePaneActionOutcome> {
  const admission = await tryRunWorkspacePaneAction(actionTarget, commit)
  return admission.kind === 'busy' ? { kind: 'blocked' } : admission.result
}
