import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { branchWorktreeChanges, branchWorktreeStatus } from '#/web/stores/workspaces/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { PullRequestInfo } from '#/shared/git-types.ts'

export type CurrentGitWorkspacePane = ReturnType<typeof getCurrentGitWorkspacePane>
export type CurrentGitWorkspacePanePresentation = ReturnType<typeof getCurrentGitWorkspacePanePresentation>

export interface PullRequestReadPresentation {
  state: 'pending' | 'unavailable' | 'error' | 'empty' | 'ready'
  stale: boolean
  error: string | null
  retrying: boolean
  retry: () => void
}

export interface GitWorkspacePaneProjection extends BranchActionRepo {
  probe: Extract<WorkspaceState['capability'], { kind: 'git' }>['probe']
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
}

export function getCurrentGitWorkspacePane(workspace: GitWorkspacePaneProjection, pullRequest?: PullRequestInfo) {
  const branch =
    workspace.snapshot.branches.find((candidate) => candidate.name === workspace.ui.currentBranchName) ?? null
  const currentBranchStatus = branchWorktreeStatus(workspace.status, branch)
  const worktreeChanges = branch ? branchWorktreeChanges(workspace.status, branch) : undefined
  const statusCount = worktreeChanges?.changeCount

  // The Git pane projection reads the target from the lifecycle
  // union via `remoteWorkspaceTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `workspaceId` is forwarded so consumers can
  // re-resolve the live lifecycle via `useWorkspacesStore` (the
  // presentation object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return { workspaceId: workspace.id, branch, pullRequest, currentBranchStatus, statusCount, worktreeChanges }
}

export function getCurrentGitWorkspacePanePresentation(
  workspace: GitWorkspacePaneProjection,
  status: { loading: boolean; error: string | null; stale: boolean },
  pullRequest: PullRequestInfo | undefined,
  pullRequestRead: PullRequestReadPresentation,
) {
  const detail = getCurrentGitWorkspacePane(workspace, pullRequest)

  return {
    ...detail,
    loading: {
      status: status.loading,
      pullRequests: false,
    },
    errors: {
      status: status.error,
    },
    stale: {
      status: status.stale,
    },
    pullRequestRead,
  }
}
