import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { terminalWorkspacePaneTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { commitWorkspacePaneRouteSupplement } from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  beginPrimaryWindowNavigationIntent,
  resetPrimaryWindowNavigationForTest,
  type PrimaryWindowNavigationIntent,
} from '#/web/primary-window-navigation-lifecycle.ts'
import {
  resolveWorkspacePaneDestinationTargetLease,
  workspacePaneTargetLeaseIsCurrent,
  type WorkspacePaneDestinationTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'

export type WorkspacePaneDestinationNavigation = Pick<PrimaryWindowNavigationActions, 'commitWorkspacePaneRoute'>

export interface WorkspacePaneDestinationPresentation {
  intent: PrimaryWindowNavigationIntent
  lease: WorkspacePaneDestinationTargetLease
  [Symbol.dispose](): void
}

export function beginWorkspacePaneDestinationPresentation(
  lease: WorkspacePaneDestinationTargetLease,
): WorkspacePaneDestinationPresentation {
  const intent = beginPrimaryWindowNavigationIntent('user')
  return { intent, lease, [Symbol.dispose]: () => intent.release() }
}

export function workspacePaneDestinationPresentationIsCurrent(
  presentation: WorkspacePaneDestinationPresentation,
): boolean {
  return presentation.intent.isCurrent() && workspacePaneTargetLeaseIsCurrent(presentation.lease)
}

export function resetWorkspacePaneDestinationPresentationForTest(): void {
  resetPrimaryWindowNavigationForTest()
}

export async function dispatchWorkspacePaneDestinationRoute(input: {
  workspaceId: WorkspaceId
  branchName: string
  route: WorkspacePaneRouteTarget
  navigation: WorkspacePaneDestinationNavigation
  options?: { replace?: boolean }
}): Promise<WorkspacePaneActionOutcome> {
  const lease = resolveWorkspacePaneDestinationTargetLease(input.workspaceId, input.branchName)
  if (!lease) return { kind: 'target-missing' }
  if (!workspacePaneDestinationRouteSupported(lease, input.route)) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  using presentation = beginWorkspacePaneDestinationPresentation(lease)
  return await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: lease.workspaceId,
      workspaceRuntimeId: lease.workspaceRuntimeId,
      branchName: lease.branchName,
      worktreePath: lease.worktreePath,
    }),
    () => commitWorkspacePaneDestinationRoute(presentation, input.route, input.navigation, input.options),
  )
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
  navigation: WorkspacePaneDestinationNavigation,
  options?: { replace?: boolean },
): Promise<WorkspacePaneActionOutcome> {
  if (!workspacePaneDestinationPresentationIsCurrent(presentation)) return { kind: 'superseded' }
  const { lease } = presentation
  let accepted = false
  let supplementCommitted = false
  try {
    accepted = await navigation.commitWorkspacePaneRoute(lease.workspaceId, lease.branchName, route, {
      ...options,
      navigationIntent: presentation.intent,
      onCommit: () => {
        supplementCommitted = commitWorkspacePaneRouteSupplement(lease, route)
      },
    })
  } catch {
    return { kind: 'navigation-rejected' }
  }
  if (!accepted) return { kind: 'navigation-rejected' }
  if (!workspacePaneTargetLeaseIsCurrent(presentation.lease)) return { kind: 'superseded' }
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
