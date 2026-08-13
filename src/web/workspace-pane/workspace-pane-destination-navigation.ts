import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { FilesystemWorkspacePaneRouteCommitActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { commitWorkspacePaneRouteSupplement } from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  resetAppNavigationForTest,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'
import {
  isGitWorktreeDestinationTargetLease,
  workspacePaneTargetLeaseIsCurrent,
  type WorkspacePaneDestinationTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'

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
  navigation: FilesystemWorkspacePaneRouteCommitActions,
  options?: { replace?: boolean },
): Promise<WorkspacePaneActionOutcome> {
  if (!workspacePaneDestinationPresentationIsCurrent(presentation)) return { kind: 'superseded' }
  const { lease } = presentation
  if (isGitWorktreeDestinationTargetLease(lease)) {
    try {
      const accepted = await navigation.commitFilesystemWorkspacePaneRoute(
        {
          routeTarget: lease.routeTarget,
          workspaceRuntimeId: lease.workspaceRuntimeId,
        },
        route,
        { ...options, navigationGeneration: presentation.generation },
      )
      if (!accepted) return { kind: 'navigation-rejected' }
    } catch {
      return { kind: 'navigation-rejected' }
    }
    return workspacePaneDestinationPresentationIsCurrent(presentation)
      ? { kind: 'completed', changed: true, presentation: 'router-settled' }
      : { kind: 'superseded' }
  }

  if (route?.kind === 'terminal') return { kind: 'unsupported', reason: 'worktree-required' }
  let supplementCommitted = false
  try {
    const accepted = await navigation.commitWorkspacePaneRoute(
      lease.routeTarget.workspaceId,
      lease.routeTarget.branchName,
      route,
      {
        ...options,
        navigationGeneration: presentation.generation,
        onCommit: () => {
          supplementCommitted = commitWorkspacePaneRouteSupplement(lease, route)
        },
      },
    )
    if (!accepted) return { kind: 'navigation-rejected' }
  } catch {
    return { kind: 'navigation-rejected' }
  }
  if (!workspacePaneDestinationPresentationIsCurrent(presentation)) return { kind: 'superseded' }
  if (!supplementCommitted) return { kind: 'superseded' }
  return { kind: 'completed', changed: true, presentation: 'router-settled' }
}
