import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneRouteCommitActions } from '#/web/app-navigation-actions.ts'
import { terminalWorkspacePaneTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { commitWorkspacePaneRouteSupplement } from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  resetAppNavigationForTest,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'
import {
  resolveWorkspacePaneDestinationTargetLease,
  workspacePaneTargetLeaseIsCurrent,
  type WorkspacePaneDestinationTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  tryRunWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'

export interface WorkspacePaneDestinationPresentation {
  generation: AppNavigationGeneration
  lease: WorkspacePaneDestinationTargetLease
}

export function beginWorkspacePaneDestinationPresentation(
  lease: WorkspacePaneDestinationTargetLease,
): WorkspacePaneDestinationPresentation {
  return { generation: beginAppNavigation(), lease }
}

export function workspacePaneDestinationPresentationIsCurrent(
  presentation: WorkspacePaneDestinationPresentation,
): boolean {
  return appNavigationIsCurrent(presentation.generation) && workspacePaneTargetLeaseIsCurrent(presentation.lease)
}

export function resetWorkspacePaneDestinationPresentationForTest(): void {
  resetAppNavigationForTest()
}

export async function dispatchWorkspacePaneDestinationRoute(input: {
  workspaceId: WorkspaceId
  branchName: string
  route: WorkspacePaneRouteTarget
  navigation: WorkspacePaneRouteCommitActions
  options?: { replace?: boolean }
}): Promise<WorkspacePaneActionOutcome> {
  const lease = resolveWorkspacePaneDestinationTargetLease(input.workspaceId, input.branchName)
  if (!lease) return { kind: 'target-missing' }
  if (!workspacePaneDestinationRouteSupported(lease, input.route)) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  const admission = await tryRunWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: lease.workspaceId,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      branchName: lease.branchName,
      worktreePath: lease.worktreePath,
    }),
    () =>
      commitWorkspacePaneDestinationRoute(
        beginWorkspacePaneDestinationPresentation(lease),
        input.route,
        input.navigation,
        input.options,
      ),
  )
  return admission.kind === 'busy' ? { kind: 'blocked' } : admission.result
}

/**
 * Commits an absolute destination route from live Git Workspace/branch identity.
 * Unlike a current-target presentation lease, this never reads route-controller
 * observation state. Callers that mutate server state first must invoke this
 * only after applying the canonical snapshot; the lease check then rejects a
 * reopened workspace runtime or a branch whose worktree identity changed meanwhile.
 */
export async function commitWorkspacePaneDestinationRoute(
  presentation: WorkspacePaneDestinationPresentation,
  route: WorkspacePaneRouteTarget,
  navigation: WorkspacePaneRouteCommitActions,
  options?: { replace?: boolean },
): Promise<WorkspacePaneActionOutcome> {
  if (!workspacePaneDestinationPresentationIsCurrent(presentation)) return { kind: 'superseded' }
  const { lease } = presentation
  let accepted = false
  let supplementCommitted = false
  try {
    accepted = await navigation.commitWorkspacePaneRoute(lease.workspaceId, lease.branchName, route, {
      ...options,
      navigationGeneration: presentation.generation,
      onCommit: () => {
        supplementCommitted = commitWorkspacePaneRouteSupplement(lease, route)
      },
    })
  } catch {
    return { kind: 'navigation-rejected' }
  }
  if (!accepted) return { kind: 'navigation-rejected' }
  if (!workspacePaneDestinationPresentationIsCurrent(presentation)) return { kind: 'superseded' }
  if (!supplementCommitted) return { kind: 'superseded' }
  return { kind: 'completed', changed: true, presentation: 'router-settled' }
}

function workspacePaneDestinationRouteSupported(
  lease: WorkspacePaneDestinationTargetLease,
  route: WorkspacePaneRouteTarget,
): boolean {
  if (route === null) return true
  const availability = { hasWorktree: lease.worktreePath !== null }
  return route.kind === 'static'
    ? workspacePaneStaticTabProvider(route.tab).canOpen(availability)
    : terminalWorkspacePaneTabProvider.canOpen(availability)
}
