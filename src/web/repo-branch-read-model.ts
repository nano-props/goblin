import type { QueryClient } from '@tanstack/react-query'
import {
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  useRepoSnapshotReadModel,
  useRepoStatusReadModel,
} from '#/web/repo-data-query.ts'
import { stripBranchWorktreeMetadata, worktreeStatesFromBranchReadModel } from '#/web/stores/repos/worktree-state.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'

export interface RepoBranchReadModelData {
  branches: RepoState['data']['branches']
  currentBranch: string
  currentHEAD?: string
  status: RepoState['data']['status']
  worktreesByPath: RepoState['data']['worktreesByPath']
}

export type RepoBranchSnapshotData = Pick<RepoBranchReadModelData, 'branches' | 'currentBranch' | 'currentHEAD'>

export function repoBranchSnapshotDataFromSnapshot(snapshot: RepoSnapshot): RepoBranchSnapshotData {
  return {
    branches: stripBranchWorktreeMetadata(snapshot.branches),
    currentBranch: snapshot.current,
    currentHEAD: snapshot.currentHEAD,
  }
}

export function repoBranchReadModelFromSnapshot(
  snapshot: RepoSnapshot,
  status: RepoState['data']['status'],
): RepoBranchReadModelData {
  return {
    ...repoBranchSnapshotDataFromSnapshot(snapshot),
    status,
    worktreesByPath: worktreeStatesFromBranchReadModel(snapshot.branches, status),
  }
}

export function useRepoBranchReadModel(
  repoRoot: string,
  repoInstanceId: string,
  enabled: boolean,
): RepoBranchReadModelData | null {
  const snapshotReadModel = useRepoSnapshotReadModel(repoRoot, repoInstanceId, enabled)
  const statusReadModel = useRepoStatusReadModel(repoRoot, repoInstanceId, enabled)
  if (!enabled) return null
  if (!snapshotReadModel.data || !statusReadModel.data) return null
  return repoBranchReadModelFromSnapshot(snapshotReadModel.data, statusReadModel.data)
}

export function readRepoBranchQueryProjection(
  repo: Pick<RepoState, 'id' | 'instanceId'>,
  queryClient?: QueryClient,
): RepoBranchReadModelData | null {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.instanceId, queryClient)
  const status = getRepoStatusQueryData(repo.id, repo.instanceId, queryClient)
  if (!snapshot) return null
  if (!status) return null
  return repoBranchReadModelFromSnapshot(snapshot, status)
}

export function requireRepoBranchQueryProjection(
  repo: Pick<RepoState, 'id' | 'instanceId'>,
  queryClient?: QueryClient,
): RepoBranchReadModelData {
  const projection = readRepoBranchQueryProjection(repo, queryClient)
  if (!projection) throw new Error(`repo branch read model query data unavailable for repo: ${repo.id}`)
  return projection
}
