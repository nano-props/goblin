import type { RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  resolveWorkspacePaneDestinationTargetLease,
  workspacePaneDestinationTargetLeaseIsCurrent,
  type WorkspacePaneDestinationTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

export type WorkspacePaneDestinationNavigation = Pick<
  PrimaryWindowNavigationActions,
  'commitRepoBranchWorkspacePaneRoute'
>

export async function dispatchWorkspacePaneDestinationRoute(input: {
  repoId: string
  branchName: string
  route: RepoBranchWorkspacePaneRouteTarget
  navigation: WorkspacePaneDestinationNavigation
  options?: { replace?: boolean }
}): Promise<boolean> {
  const lease = resolveWorkspacePaneDestinationTargetLease(input.repoId, input.branchName)
  if (!lease) return false
  return await runWorkspacePaneTabCoordinatorTask(lease, () =>
    commitWorkspacePaneDestinationRoute(lease, input.route, input.navigation, input.options),
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
  lease: WorkspacePaneDestinationTargetLease,
  route: RepoBranchWorkspacePaneRouteTarget,
  navigation: WorkspacePaneDestinationNavigation,
  options?: { replace?: boolean },
): Promise<boolean> {
  if (!workspacePaneDestinationTargetLeaseIsCurrent(lease)) return false
  try {
    return await navigation.commitRepoBranchWorkspacePaneRoute(lease.repoId, lease.branchName, route, options)
  } catch {
    return false
  }
}
