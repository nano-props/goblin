import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemRootPath } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import { gitHeadBranch } from '#/shared/git-head.ts'

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
