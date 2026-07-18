import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { terminalWorkspacePaneTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { commitWorkspacePaneRouteSupplement } from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  resetPrimaryWindowPresentationForTest,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import {
  resolveWorkspacePaneDestinationTargetLease,
  workspacePaneTargetLeaseIsCurrent,
  type WorkspacePaneDestinationTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'

export type WorkspacePaneDestinationNavigation = Pick<
  PrimaryWindowNavigationActions,
  'commitWorkspacePaneRoute'
>

export interface WorkspacePaneDestinationPresentation {
  token: PrimaryWindowPresentationToken
  lease: WorkspacePaneDestinationTargetLease
}

export function beginWorkspacePaneDestinationPresentation(
  lease: WorkspacePaneDestinationTargetLease,
): WorkspacePaneDestinationPresentation {
  return { token: beginPrimaryWindowPresentation(), lease }
}

export function workspacePaneDestinationPresentationIsCurrent(
  presentation: WorkspacePaneDestinationPresentation,
): boolean {
  return primaryWindowPresentationIsCurrent(presentation.token) && workspacePaneTargetLeaseIsCurrent(presentation.lease)
}

export function resetWorkspacePaneDestinationPresentationForTest(): void {
  resetPrimaryWindowPresentationForTest()
}

export async function dispatchWorkspacePaneDestinationRoute(input: {
  repoId: string
  branchName: string
  route: WorkspacePaneRouteTarget
  navigation: WorkspacePaneDestinationNavigation
  options?: { replace?: boolean }
}): Promise<WorkspacePaneActionOutcome> {
  const lease = resolveWorkspacePaneDestinationTargetLease(input.repoId, input.branchName)
  if (!lease) return { kind: 'target-missing' }
  if (!workspacePaneDestinationRouteSupported(lease, input.route)) {
    return { kind: 'unsupported', reason: 'worktree-required' }
  }
  const presentation = beginWorkspacePaneDestinationPresentation(lease)
  return await runWorkspacePaneAction(workspacePaneActionTargetFromCoordinates(lease), () =>
    commitWorkspacePaneDestinationRoute(presentation, input.route, input.navigation, input.options),
  )
}

/**
 * Commits an absolute destination route from live repo/branch identity.
 * Unlike a current-target presentation lease, this never reads route-controller
 * observation state. Callers that mutate server state first must invoke this
 * only after applying the canonical snapshot; the lease check then rejects a
 * reopened repo runtime or a branch whose worktree identity changed meanwhile.
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
    accepted = await navigation.commitWorkspacePaneRoute(lease.repoId, lease.branchName, route, {
      ...options,
      presentationToken: presentation.token,
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
