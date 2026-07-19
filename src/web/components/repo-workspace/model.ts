import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { getBranchWorktreeState, selectedBranchStatus } from '#/web/stores/workspaces/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'

export type CurrentGitWorkspacePane = ReturnType<typeof getCurrentGitWorkspacePane>
export type CurrentGitWorkspacePanePresentation = ReturnType<typeof getCurrentGitWorkspacePanePresentation>

export interface GitWorkspacePaneProjection extends BranchActionRepo {
  branchModel: RepoBranchReadModelData
  probe: Extract<WorkspaceState['capability'], { kind: 'git' }>['probe']
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
  unavailable: boolean
}

export function getCurrentGitWorkspacePane(workspace: GitWorkspacePaneProjection) {
  const branch =
    workspace.branchModel.branches.find((candidate) => candidate.name === workspace.ui.currentBranchName) ?? null
  const currentBranchStatus = selectedBranchStatus(workspace, branch)
  const worktreeState = branch ? getBranchWorktreeState(workspace, branch) : null
  const statusCount = worktreeState?.changeCount ?? currentBranchStatus.reduce((n, wt) => n + wt.entries.length, 0)

  // The Git pane projection reads the target from the lifecycle
  // union via `remoteWorkspaceTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `workspaceId` is forwarded so consumers can
  // re-resolve the live lifecycle via `useWorkspacesStore` (the
  // presentation object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return { workspaceId: workspace.id, branch, currentBranchStatus, statusCount, worktreeState }
}

export function getCurrentGitWorkspacePanePresentation(
  workspace: GitWorkspacePaneProjection,
  status: { loading: boolean; error: string | null; stale: boolean },
) {
  const detail = getCurrentGitWorkspacePane(workspace)

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
  }
}
