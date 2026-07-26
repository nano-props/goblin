import type { RepoSnapshot } from '#/shared/api-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { repoBranchSnapshotDataFromSnapshot } from '#/web/repo-branch-read-model.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

type ReadModelStatus = 'pending' | 'error' | 'success'
type CommandWorkspace = Pick<WorkspaceState, 'id' | 'workspaceRuntimeId' | 'capability'>

interface BranchReadModelInput {
  status: ReadModelStatus
  snapshot: RepoSnapshot | null
}

interface WorktreeReadModelInput {
  status: ReadModelStatus
  worktrees: WorktreeStatus[] | null
}

interface WorkspacePaneCommandTargetProjectionInput {
  routeTarget: WorkspacePaneTabsTarget | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null
  workspace: CommandWorkspace | null
  branchReadModel: BranchReadModelInput
  worktreeReadModel: WorktreeReadModelInput
}

export interface WorkspacePaneCommandTargetProjection {
  routeAuthority: 'pending' | 'resolved'
  target: WorkspacePaneCommandTarget | null
}

export function resolveWorkspacePaneCommandTarget(
  input: WorkspacePaneCommandTargetProjectionInput,
): WorkspacePaneCommandTargetProjection {
  const { routeTarget, workspacePaneRoute, workspace } = input
  if (!routeTarget) return { routeAuthority: 'resolved', target: null }
  if (!workspace) return { routeAuthority: 'resolved', target: null }
  if (workspace.id !== routeTarget.workspaceId) return { routeAuthority: 'resolved', target: null }
  if (workspace.capability.kind === 'probing') return { routeAuthority: 'pending', target: null }

  if (routeTarget.kind === 'workspace-root') {
    const capability = workspace.capability
    if (capability.kind !== 'git' && capability.kind !== 'filesystem') {
      return { routeAuthority: 'resolved', target: null }
    }
    return {
      routeAuthority: 'resolved',
      target: {
        routeTarget,
        workspacePaneRoute,
        filesystemTarget: workspaceRootPaneFilesystemTarget({
          workspaceId: workspace.id,
          workspaceRuntimeId: workspace.workspaceRuntimeId,
          capabilities: capability.probe.capabilities,
        }),
      },
    }
  }

  if (routeTarget.kind === 'git-branch') {
    if (workspace.capability.kind === 'git' && input.branchReadModel.status === 'pending') {
      return {
        routeAuthority: 'pending',
        target: {
          routeTarget,
          workspacePaneRoute,
          filesystemTarget: null,
        },
      }
    }
    return {
      routeAuthority: 'resolved',
      target: {
        routeTarget,
        workspacePaneRoute,
        filesystemTarget: resolveBranchFilesystemTarget({
          routeTarget,
          workspace,
          branchReadModel: input.branchReadModel,
          worktreeReadModel: input.worktreeReadModel,
        }),
      },
    }
  }

  if (workspace.capability.kind === 'git' && input.worktreeReadModel.status === 'pending') {
    return { routeAuthority: 'pending', target: null }
  }
  if (workspace.capability.kind !== 'git') return { routeAuthority: 'resolved', target: null }
  if (input.worktreeReadModel.status === 'error') return { routeAuthority: 'resolved', target: null }
  const worktree = input.worktreeReadModel.worktrees?.find((entry) => entry.path === routeTarget.worktreePath)
  if (!worktree) return { routeAuthority: 'resolved', target: null }
  if (worktree.branch && input.branchReadModel.status === 'pending') {
    return { routeAuthority: 'pending', target: null }
  }
  return {
    routeAuthority: 'resolved',
    target: {
      routeTarget,
      workspacePaneRoute,
      filesystemTarget: gitWorktreePaneFilesystemTarget({
        workspaceId: workspace.id,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        worktreePath: routeTarget.worktreePath,
        head: gitHead(worktree.branch ?? null),
        capabilities: workspace.capability.probe.capabilities,
      }),
    },
  }
}

function resolveBranchFilesystemTarget(input: {
  routeTarget: Extract<WorkspacePaneTabsTarget, { kind: 'git-branch' }>
  workspace: CommandWorkspace
  branchReadModel: BranchReadModelInput
  worktreeReadModel: WorktreeReadModelInput
}): Extract<NonNullable<WorkspacePaneCommandTarget['filesystemTarget']>, { kind: 'git-worktree' }> | null {
  const { routeTarget, workspace } = input
  if (
    workspace.capability.kind !== 'git' ||
    input.branchReadModel.status !== 'success' ||
    input.worktreeReadModel.status !== 'success' ||
    !input.branchReadModel.snapshot
  ) {
    return null
  }
  const branch = repoBranchSnapshotDataFromSnapshot(input.branchReadModel.snapshot).branches.find(
    (entry) => entry.name === routeTarget.branchName,
  )
  const worktreePath = branch?.worktree?.path
  if (
    !worktreePath ||
    !input.worktreeReadModel.worktrees?.some(
      (worktree) => worktree.path === worktreePath && worktree.branch === routeTarget.branchName,
    )
  ) {
    return null
  }
  return gitWorktreePaneFilesystemTarget({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    worktreePath,
    head: gitHead(routeTarget.branchName),
    capabilities: workspace.capability.probe.capabilities,
  })
}
