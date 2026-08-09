import type { QueryClient } from '@tanstack/query-core'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { RepoSnapshotResponse, RepoWorktreeStatusSnapshot } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneFilesystemRootPath,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import { gitHead, gitHeadBranch } from '#/shared/git-head.ts'
import type { WorkspaceRouteContext } from '#/web/app-layout-model.ts'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

export type WorkspacePaneCommandTarget =
  | {
      routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'git-branch' }>
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: Extract<WorkspacePaneFilesystemTarget, { kind: 'git-worktree' }> | null
    }
  | {
      routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'git-worktree' }>
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: Extract<WorkspacePaneFilesystemTarget, { kind: 'git-worktree' }>
    }
  | {
      routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'workspace-root' }>
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: Extract<WorkspacePaneFilesystemTarget, { kind: 'workspace-root' }>
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
    const branch =
      snapshotQuery?.status === 'success'
        ? snapshotQuery.data?.snapshot.branches.find((candidate) => candidate.name === routeContext.branchName)
        : undefined
    const worktreePath = branch?.worktree?.path ?? null
    return {
      routeTarget: {
        kind: 'git-branch',
        workspaceId: workspace.id,
        branchName: routeContext.branchName,
      },
      workspacePaneRoute: routeContext.workspacePaneRoute,
      filesystemTarget:
        workspace.capability.kind === 'git' && worktreePath
          ? gitWorktreePaneFilesystemTarget({
              workspaceId: workspace.id,
              workspaceRuntimeId: workspace.workspaceRuntimeId,
              worktreePath,
              head: gitHead(routeContext.branchName),
              capabilities: workspace.capability.probe.capabilities,
            })
          : null,
    }
  }

  if (routeContext.kind === 'worktree' && routeContext.worktreePath && workspace.capability.kind === 'git') {
    const statusQuery = input.queryClient.getQueryState<RepoWorktreeStatusSnapshot>(
      repoWorktreeStatusQueryKey(workspace.id, workspace.workspaceRuntimeId),
    )
    const worktree =
      statusQuery?.status === 'success'
        ? statusQuery.data?.status.find((candidate) => candidate.path === routeContext.worktreePath)
        : undefined
    if (!worktree) return null
    return {
      routeTarget: {
        kind: 'git-worktree',
        workspaceId: workspace.id,
        worktreePath: routeContext.worktreePath,
      },
      workspacePaneRoute: routeContext.workspacePaneRoute,
      filesystemTarget: gitWorktreePaneFilesystemTarget({
        workspaceId: workspace.id,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        worktreePath: routeContext.worktreePath,
        head: gitHead(worktree.branch ?? null),
        capabilities: workspace.capability.probe.capabilities,
      }),
    }
  }

  if (
    routeContext.kind === 'workspace-root' &&
    (workspace.capability.kind === 'git' || workspace.capability.kind === 'filesystem')
  ) {
    return {
      routeTarget: { kind: 'workspace-root', workspaceId: workspace.id },
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
    routeTarget: target.routeTarget,
    branchName:
      target.routeTarget.kind === 'git-branch'
        ? target.routeTarget.branchName
        : target.filesystemTarget?.kind === 'git-worktree'
          ? gitHeadBranch(target.filesystemTarget.head)
          : null,
    workspacePaneRoute: target.workspacePaneRoute,
    filesystemTarget: target.filesystemTarget,
  }
}

export function workspacePaneCommandPaneTarget(
  workspaceId: WorkspaceId,
  target: WorkspacePaneCommandTarget,
): WorkspacePaneTabsTarget {
  if (target.filesystemTarget?.kind === 'workspace-root') {
    return { kind: 'workspace-root', workspaceId }
  }
  if (target.filesystemTarget?.kind === 'git-worktree') {
    return {
      kind: 'git-worktree',
      workspaceId,
      worktreePath: workspacePaneFilesystemRootPath(target.filesystemTarget),
    }
  }
  return target.routeTarget
}

export function workspacePaneCommandRouteTarget(target: WorkspacePaneCommandTarget): WorkspacePaneTabsTarget {
  return target.routeTarget
}

export function workspacePaneCommandWorktreeHead(target: WorkspacePaneCommandTarget): GitHead | undefined {
  return target.filesystemTarget?.kind === 'git-worktree' ? target.filesystemTarget.head : undefined
}
