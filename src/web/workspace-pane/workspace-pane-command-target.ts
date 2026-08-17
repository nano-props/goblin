import type { QueryClient } from '@tanstack/query-core'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspaceCapabilities } from '#/shared/workspace-runtime.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { WorkspaceRouteContext } from '#/web/app/navigation/layout-model.ts'
import { repoSnapshotQueryKey } from '#/web/repos/query-keys.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import {
  workspacePaneLocationForBranchTarget,
  workspacePaneFilesystemTargetForLocation,
  workspacePaneLocationBranchName,
  workspacePaneLocationForWorktree,
  workspacePaneLocationForRoot,
  type WorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

export type FilesystemWorkspacePaneCommandTarget = {
  location: Exclude<WorkspacePaneLocation, { kind: 'branch' }>
  workspacePaneRoute: WorkspacePaneCommandRoute
  capabilities: WorkspaceCapabilities
}

export type WorkspacePaneCommandTarget =
  | FilesystemWorkspacePaneCommandTarget
  | {
      location: Extract<WorkspacePaneLocation, { kind: 'branch' }>
      workspacePaneRoute: WorkspacePaneCommandRoute
    }

export function workspacePaneCommandTargetHasFilesystem(
  target: WorkspacePaneCommandTarget,
): target is FilesystemWorkspacePaneCommandTarget {
  return target.location.kind !== 'branch'
}

export function workspacePaneCommandTargetFromQueryCache(input: {
  routeContext: WorkspaceRouteContext | null
  workspace: WorkspaceState | undefined
  queryClient: QueryClient
}): WorkspacePaneCommandTarget | null {
  const routeContext = input.routeContext
  const workspace = input.workspace
  if (!routeContext || !workspace) return null

  if (routeContext.kind === 'branch' && routeContext.branchName) {
    const snapshotQuery =
      workspace.capability.kind === 'git'
        ? input.queryClient.getQueryState<RepoSnapshotResponse>(
            repoSnapshotQueryKey(workspace.id, workspace.workspaceRuntimeId),
          )
        : undefined
    const snapshot = snapshotQuery?.data?.snapshot
    if (!snapshot?.branches.some((branch) => branch.name === routeContext.branchName)) return null
    if (repoWorktreeForBranch(snapshot.worktrees, routeContext.branchName)) return null
    const routeTarget = { kind: 'git-branch' as const, workspaceId: workspace.id, branchName: routeContext.branchName }
    return {
      location: workspacePaneLocationForBranchTarget(routeTarget, workspace.workspaceRuntimeId),
      workspacePaneRoute: routeContext.workspacePaneRoute,
    }
  }

  if (routeContext.kind === 'worktree' && routeContext.worktreePath && workspace.capability.kind === 'git') {
    const snapshotQuery = input.queryClient.getQueryState<RepoSnapshotResponse>(
      repoSnapshotQueryKey(workspace.id, workspace.workspaceRuntimeId),
    )
    const worktree = snapshotQuery?.data?.snapshot.worktrees.find(
      (candidate) => candidate.path === routeContext.worktreePath,
    )
    if (!worktree) return null
    const location = workspacePaneLocationForWorktree(workspace.id, workspace.workspaceRuntimeId, worktree)
    return {
      location,
      workspacePaneRoute: routeContext.workspacePaneRoute,
      capabilities: workspace.capability.probe.capabilities,
    }
  }

  if (
    routeContext.kind === 'workspace-root' &&
    (workspace.capability.kind === 'git' || workspace.capability.kind === 'filesystem')
  ) {
    const location = workspacePaneLocationForRoot(workspace.id, workspace.workspaceRuntimeId)
    return {
      location,
      workspacePaneRoute: routeContext.workspacePaneRoute,
      capabilities: workspace.capability.probe.capabilities,
    }
  }

  return null
}

export function workspacePaneCommandCoordinates(target: WorkspacePaneCommandTarget): {
  routeTarget: WorkspacePaneTabsTarget
  branchName: string | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  filesystemTarget: WorkspacePaneFilesystemTarget | null
} {
  const filesystemTarget = workspacePaneCommandTargetHasFilesystem(target)
    ? workspacePaneCommandFilesystemTarget(target)
    : null
  return {
    routeTarget: target.location.routeTarget,
    branchName: workspacePaneLocationBranchName(target.location),
    workspacePaneRoute: target.workspacePaneRoute,
    filesystemTarget,
  }
}

function workspacePaneCommandFilesystemTarget(
  target: FilesystemWorkspacePaneCommandTarget,
): WorkspacePaneFilesystemTarget {
  if (target.location.kind === 'workspace-root') {
    return workspacePaneFilesystemTargetForLocation(target.location, target.capabilities)
  }
  if (target.capabilities.git.status !== 'available') {
    throw new Error('Git worktree command target requires Git capabilities')
  }
  const capabilities = { ...target.capabilities, git: target.capabilities.git }
  return workspacePaneFilesystemTargetForLocation(target.location, capabilities)
}

export function workspacePaneCommandPaneTarget(target: WorkspacePaneCommandTarget): WorkspacePaneTabsTarget {
  return target.location.paneTarget
}

export function workspacePaneCommandRouteTarget(target: WorkspacePaneCommandTarget): WorkspacePaneTabsTarget {
  return target.location.routeTarget
}

export function workspacePaneCommandWorktreeHead(target: WorkspacePaneCommandTarget): GitHead | undefined {
  return target.location.worktreeHead ?? undefined
}

export function workspacePaneCommandRuntimeId(target: WorkspacePaneCommandTarget): string {
  return target.location.workspaceRuntimeId
}
