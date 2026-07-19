import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { GitHead } from '#/shared/git-head.ts'
import { gitHeadBranch } from '#/shared/git-head.ts'

export type WorkspacePaneCommandTarget =
  | {
      kind: 'git-branch'
      branchName: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
    }
  | {
      kind: 'git-worktree'
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: Extract<WorkspacePaneFilesystemTarget, { kind: 'git-worktree' }>
    }
  | {
      kind: 'workspace-root'
      workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
      filesystemTarget: Extract<WorkspacePaneFilesystemTarget, { kind: 'workspace-root' }>
    }

export function workspacePaneCommandCoordinates(target: WorkspacePaneCommandTarget): {
  branchName: string | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  filesystemTarget: WorkspacePaneFilesystemTarget | null
} {
  return target.kind === 'git-branch'
    ? {
        branchName: target.branchName,
        workspacePaneRoute: target.workspacePaneRoute,
        filesystemTarget: null,
      }
    : {
        branchName: target.kind === 'git-worktree' ? gitHeadBranch(target.filesystemTarget.head) : null,
        workspacePaneRoute: target.workspacePaneRoute,
        filesystemTarget: target.filesystemTarget,
      }
}

export function workspacePaneCommandPaneTarget(
  workspaceId: WorkspaceId,
  target: WorkspacePaneCommandTarget,
): WorkspacePaneTabsTarget {
  if (target.kind === 'workspace-root') return { kind: 'workspace-root', workspaceId: workspaceId }
  if (target.kind === 'git-worktree') {
    return { kind: 'git-worktree', workspaceId: workspaceId, worktreePath: target.filesystemTarget.rootPath }
  }
  return { kind: 'git-branch', workspaceId: workspaceId, branchName: target.branchName }
}

export function workspacePaneCommandWorktreeHead(target: WorkspacePaneCommandTarget): GitHead | undefined {
  return target.kind === 'git-worktree' ? target.filesystemTarget.head : undefined
}
