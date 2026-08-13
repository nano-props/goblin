import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { terminalExecutionCoordinates, terminalExecutionPath } from '#/shared/terminal-types.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { isWorkspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { appNavigationIsCurrent, beginAppNavigation } from '#/web/app-navigation-lifecycle.ts'
import {
  tryRunWorkspacePaneAction,
  workspacePaneActionTargetFromCoordinates,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  gitWorktreePaneTargetLease,
  workspaceRootPaneTargetLease,
  type FilesystemWorkspacePaneTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'

export function commitWorkspacePaneTerminalDestination(input: {
  base: TerminalSessionBase
  terminalSessionId: string
  navigation: AppNavigationActions
}): Promise<WorkspacePaneActionOutcome> {
  const coordinates = terminalExecutionCoordinates(input.base.target)
  const paneTarget = workspacePaneTabsTargetFromRuntime(input.base.target)
  if (!paneTarget) return Promise.resolve({ kind: 'target-missing' })
  if (input.base.target.kind === 'workspace-root') {
    if (input.base.presentation.kind !== 'workspace-root') return Promise.resolve({ kind: 'target-missing' })
    const target = workspaceRootPaneTargetLease(coordinates.workspaceId, coordinates.workspaceRuntimeId)
    return commitFilesystemTerminalDestination({
      navigation: input.navigation,
      target,
      paneTarget,
      actionTarget: workspacePaneActionTargetFromCoordinates({
        workspaceId: coordinates.workspaceId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        branchName: null,
        worktreePath: null,
      }),
      terminalSessionId: input.terminalSessionId,
    })
  }
  if (input.base.presentation.kind !== 'git-worktree') return Promise.resolve({ kind: 'target-missing' })
  const worktreePath = terminalExecutionPath(input.base.target)
  return commitFilesystemTerminalDestination({
    navigation: input.navigation,
    target: gitWorktreePaneTargetLease(coordinates.workspaceId, coordinates.workspaceRuntimeId, worktreePath),
    paneTarget,
    actionTarget: workspacePaneActionTargetFromCoordinates({
      workspaceId: coordinates.workspaceId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      branchName: null,
      worktreePath,
    }),
    terminalSessionId: input.terminalSessionId,
  })
}

function terminalPaneProjectionOutcome(
  target: NonNullable<ReturnType<typeof workspacePaneTabsTargetFromRuntime>>,
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
  paneTarget: NonNullable<ReturnType<typeof workspacePaneTabsTargetFromRuntime>>
  actionTarget: ReturnType<typeof workspacePaneActionTargetFromCoordinates>
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
