import type { QueryClient } from '@tanstack/query-core'
import type { ParsedBranchWorkspacePaneRouteTarget, ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import type {
  GitWorktreePaneFilesystemTarget,
  WorkspacePaneFilesystemTarget,
  WorkspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneTabsTargetForFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import { gitHeadBranch } from '#/shared/git-head.ts'
import type { WorkspaceRouteContext } from '#/web/app-layout-model.ts'
import { repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'

type GitBranchWorkspacePaneCommandTarget = {
  workspaceRuntimeId: string
  routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'git-branch' }>
  workspacePaneRoute: ParsedBranchWorkspacePaneRouteTarget | undefined
  filesystemTarget: null
}

export type FilesystemWorkspacePaneCommandTarget =
  | {
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: GitWorktreePaneFilesystemTarget
    }
  | {
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: WorkspaceRootPaneFilesystemTarget
    }

export type WorkspacePaneCommandTarget = GitBranchWorkspacePaneCommandTarget | FilesystemWorkspacePaneCommandTarget

export function workspacePaneCommandTargetHasFilesystem(
  target: WorkspacePaneCommandTarget,
): target is FilesystemWorkspacePaneCommandTarget {
  return target.filesystemTarget !== null
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
    return {
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      routeTarget: { kind: 'git-branch', workspaceId: workspace.id, branchName: routeContext.branchName },
      workspacePaneRoute: routeContext.workspacePaneRoute,
      filesystemTarget: null,
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
    return {
      workspacePaneRoute: routeContext.workspacePaneRoute,
      filesystemTarget: gitWorktreePaneFilesystemTarget({
        workspaceId: workspace.id,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        worktreePath: routeContext.worktreePath,
        head: worktree.head,
        capabilities: workspace.capability.probe.capabilities,
      }),
    }
  }

  if (
    routeContext.kind === 'workspace-root' &&
    (workspace.capability.kind === 'git' || workspace.capability.kind === 'filesystem')
  ) {
    return {
      workspacePaneRoute: routeContext.workspacePaneRoute,
      filesystemTarget: workspaceRootPaneFilesystemTarget({
        workspaceId: workspace.id,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        capabilities: workspace.capability.probe.capabilities,
      }),
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
  return {
    routeTarget: workspacePaneCommandRouteTarget(target),
    branchName:
      target.filesystemTarget === null
        ? target.routeTarget.branchName
        : target.filesystemTarget?.kind === 'git-worktree'
          ? gitHeadBranch(target.filesystemTarget.head)
          : null,
    workspacePaneRoute: target.workspacePaneRoute,
    filesystemTarget: target.filesystemTarget,
  }
}

export function workspacePaneCommandPaneTarget(target: WorkspacePaneCommandTarget): WorkspacePaneTabsTarget {
  return workspacePaneCommandRouteTarget(target)
}

export function workspacePaneCommandRouteTarget(target: WorkspacePaneCommandTarget): WorkspacePaneTabsTarget {
  return target.filesystemTarget === null
    ? target.routeTarget
    : workspacePaneTabsTargetForFilesystemTarget(target.filesystemTarget)
}

export function workspacePaneCommandWorktreeHead(target: WorkspacePaneCommandTarget): GitHead | undefined {
  return target.filesystemTarget?.kind === 'git-worktree' ? target.filesystemTarget.head : undefined
}

export function workspacePaneCommandRuntimeId(target: WorkspacePaneCommandTarget): string {
  return target.filesystemTarget === null ? target.workspaceRuntimeId : target.filesystemTarget.workspaceRuntimeId
}
