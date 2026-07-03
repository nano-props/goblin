import type { QueryClient } from '@tanstack/react-query'
import {
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  useRepoSnapshotReadModel,
  useRepoStatusReadModel,
} from '#/web/repo-data-query.ts'
import {
  stripBranchWorktreeMetadata,
  worktreeStatesFromBranches,
} from '#/web/stores/repos/worktree-state.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'

export interface RepoBranchReadModelData {
  branches: RepoState['data']['branches']
  currentBranch: string
  currentHEAD?: string
  worktreesByPath: RepoState['data']['worktreesByPath']
}

export function repoBranchReadModelFromSnapshot(
  snapshot: RepoSnapshot,
  current: Pick<RepoState['data'], 'status' | 'worktreesByPath'>,
): RepoBranchReadModelData {
  const branches = stripBranchWorktreeMetadata(snapshot.branches)
  return {
    branches,
    currentBranch: snapshot.current,
    currentHEAD: snapshot.currentHEAD,
    worktreesByPath: worktreeStatesFromBranches(snapshot.branches, current.worktreesByPath, current.status),
  }
}

export function useRepoBranchReadModel(
  repoRoot: string,
  repoInstanceId: string,
  current: Pick<RepoState['data'], 'status' | 'worktreesByPath'>,
  enabled: boolean,
): RepoBranchReadModelData | null {
  const snapshotReadModel = useRepoSnapshotReadModel(repoRoot, repoInstanceId, enabled)
  const statusReadModel = useRepoStatusReadModel(repoRoot, repoInstanceId, enabled)
  if (!snapshotReadModel.data) return null
  return repoBranchReadModelFromSnapshot(snapshotReadModel.data, {
    ...current,
    status: statusReadModel.data ?? current.status,
  })
}

export function readRepoBranchReadModel(
  repo: Pick<RepoState, 'id' | 'instanceId'> & {
    data: Pick<RepoState['data'], 'status' | 'worktreesByPath'>
  },
  queryClient?: QueryClient,
): RepoBranchReadModelData | null {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.instanceId, queryClient)
  if (!snapshot) return null
  return repoBranchReadModelFromSnapshot(snapshot, {
    ...repo.data,
    status: getRepoStatusQueryData(repo.id, repo.instanceId, queryClient) ?? repo.data.status,
  })
}

export function repoWithBranchReadModel<Repo extends { data: RepoState['data'] }>(
  repo: Repo,
  readModel: RepoBranchReadModelData | null,
): Repo {
  return readModel ? { ...repo, data: { ...repo.data, ...readModel } } : repo
}

export function readRepoWithBranchReadModel<Repo extends Pick<RepoState, 'id' | 'instanceId'> & { data: RepoState['data'] }>(
  repo: Repo,
  queryClient?: QueryClient,
): Repo {
  return repoWithBranchReadModel(repo, readRepoBranchReadModel(repo, queryClient))
}

export function repoBranchesFromReadModel(
  repo: Pick<RepoState, 'data'>,
  readModel: Pick<RepoBranchReadModelData, 'branches'> | null,
): RepoState['data']['branches'] {
  return readModel?.branches ?? repo.data.branches
}
