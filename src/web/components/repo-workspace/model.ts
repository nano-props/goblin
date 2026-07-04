import type { RepoState } from '#/web/stores/repos/types.ts'
import { dataLoadBusy, dataLoadInitialLoading } from '#/web/stores/repos/repo-data-load-state.ts'
import { deriveConnectivity } from '#/web/stores/repos/repo-guards.ts'
import { getBranchWorktreeState, selectedBranchStatus } from '#/web/stores/repos/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'

export interface RepoWorkspacePresentation {
  exists: boolean
  initialLoading: boolean
}

export function getRepoWorkspacePresentation(repo: RepoState | undefined): RepoWorkspacePresentation {
  if (!repo) return { exists: false, initialLoading: false }
  // Snapshot is loading when either it never resolved or the SSH probe
  // hasn't settled yet for a remote repo with no cached data. The
  // latter is the slow-network case: the placeholder repo is up but we
  // don't yet know whether the remote is reachable, so we keep showing
  // the skeleton instead of the empty state. Once cached data is
  // available the projection already shows stale branches and we drop
  // the skeleton.
  const remoteConnecting = deriveConnectivity(repo) === 'connecting'
  const hasLoadedSnapshot = repo.dataLoads.snapshot.loadedAt !== null
  return {
    exists: true,
    initialLoading: dataLoadInitialLoading(repo.dataLoads.snapshot) || (remoteConnecting && !hasLoadedSnapshot),
  }
}

export type SelectedRepoWorkspace = ReturnType<typeof getSelectedRepoWorkspace>
export type SelectedRepoWorkspacePresentation = ReturnType<typeof getSelectedRepoWorkspacePresentation>

export interface RepoWorkspaceRepo extends BranchActionRepo {
  branchModel: RepoBranchReadModelData & {
    statusReady: boolean
  }
  ui: Pick<RepoState['ui'], 'selectedBranch' | 'preferredWorkspacePaneTabByTarget'>
  dataLoads: Pick<RepoState['dataLoads'], 'status' | 'pullRequests'>
  remote: BranchActionRepo['remote'] & Pick<RepoState['remote'], 'lifecycle'>
}

export function getSelectedRepoWorkspace(repo: RepoWorkspaceRepo) {
  const branch = repo.branchModel.branches.find((b) => b.name === repo.ui.selectedBranch) ?? null
  const selectedStatus = selectedBranchStatus(repo, branch)
  const worktreeState = branch ? getBranchWorktreeState(repo, branch) : null
  const statusCount = worktreeState?.changeCount ?? selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  // The repo workspace presentation reads the target from the lifecycle
  // union via `remoteRepoTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `repoId` is forwarded so consumers can
  // re-resolve the live lifecycle via `useReposStore` (the
  // presentation object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return { repoId: repo.id, branch, selectedStatus, statusCount, worktreeState }
}

export function getSelectedRepoWorkspacePresentation(repo: RepoWorkspaceRepo) {
  const detail = getSelectedRepoWorkspace(repo)
  const statusLoading = dataLoadBusy(repo.dataLoads.status)

  return {
    ...detail,
    loading: {
      status: statusLoading,
      pullRequests: dataLoadBusy(repo.dataLoads.pullRequests),
    },
    errors: {
      status: repo.dataLoads.status.error,
    },
    stale: {
      status: repo.dataLoads.status.stale,
    },
  }
}
