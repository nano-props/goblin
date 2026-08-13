import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { worktreeChanges, worktreeStatus } from '#/web/stores/workspaces/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
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
  const worktree = branch ? (repoWorktreeForBranch(workspace.snapshot.worktrees, branch.name) ?? null) : null
  const currentBranchStatus = worktreeStatus(workspace.status, worktree?.path)
  const changes = worktreeChanges(workspace.status, worktree?.path)
  const statusCount = changes?.changeCount

  // The Git pane projection reads the target from the lifecycle
  // union via `remoteWorkspaceTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `workspaceId` is forwarded so consumers can
  // re-resolve the live lifecycle via `workspacesStore` (the
  // presentation object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return {
    workspaceId: workspace.id,
    branch,
    worktree,
    pullRequest,
    currentBranchStatus,
    statusCount,
    worktreeChanges: changes,
  }
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
