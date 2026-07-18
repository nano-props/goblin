import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { dataLoadInitialLoading } from '#/web/stores/workspaces/repo-data-load-state.ts'
import { deriveConnectivity } from '#/web/stores/workspaces/workspace-guards.ts'
import { getBranchWorktreeState, selectedBranchStatus } from '#/web/stores/workspaces/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'

export interface RepoWorkspacePresentation {
  exists: boolean
  initialLoading: boolean
}

export function getRepoWorkspacePresentation(repo: WorkspaceState | undefined): RepoWorkspacePresentation {
  if (!repo) return { exists: false, initialLoading: false }
  // The repo read model is loading when either it never resolved or the SSH probe
  // hasn't settled yet for a remote repo with no cached data. The
  // latter is the slow-network case: the placeholder repo is up but we
  // don't yet know whether the remote is reachable, so we keep showing
  // the skeleton instead of the empty state. Once cached data is
  // available the projection already shows stale branches and we drop
  // the skeleton.
  const remoteConnecting = deriveConnectivity(repo) === 'connecting'
  const hasLoadedReadModel = repo.dataLoads.repoReadModel.loadedAt !== null
  return {
    exists: true,
    initialLoading: dataLoadInitialLoading(repo.dataLoads.repoReadModel) || (remoteConnecting && !hasLoadedReadModel),
  }
}

export type CurrentRepoWorkspace = ReturnType<typeof getCurrentRepoWorkspace>
export type CurrentRepoWorkspacePresentation = ReturnType<typeof getCurrentRepoWorkspacePresentation>

export interface RepoWorkspaceRepo extends BranchActionRepo {
  branchModel: RepoBranchReadModelData
  workspaceProbe: WorkspaceState['workspaceProbe']
  ui: Pick<WorkspaceState['ui'], 'preferredWorkspacePaneTabByTarget'> & { currentBranchName: string | null }
  unavailable: boolean
  remote: BranchActionRepo['remote'] & Pick<WorkspaceState['remote'], 'lifecycle'>
}

export function getCurrentRepoWorkspace(repo: RepoWorkspaceRepo) {
  const branch = repo.branchModel.branches.find((b) => b.name === repo.ui.currentBranchName) ?? null
  const currentBranchStatus = selectedBranchStatus(repo, branch)
  const worktreeState = branch ? getBranchWorktreeState(repo, branch) : null
  const statusCount = worktreeState?.changeCount ?? currentBranchStatus.reduce((n, wt) => n + wt.entries.length, 0)

  // The repo workspace presentation reads the target from the lifecycle
  // union via `remoteRepoTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `repoId` is forwarded so consumers can
  // re-resolve the live lifecycle via `useWorkspacesStore` (the
  // presentation object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return { repoId: repo.id, branch, currentBranchStatus, statusCount, worktreeState }
}

export function getCurrentRepoWorkspacePresentation(
  repo: RepoWorkspaceRepo,
  status: { loading: boolean; error: string | null; stale: boolean },
) {
  const detail = getCurrentRepoWorkspace(repo)

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
