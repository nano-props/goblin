import type { QueryClient } from '@tanstack/react-query'
import {
  getRepoProjectionQueryData,
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  useRepoProjectionReadModel,
} from '#/web/repo-data-query.ts'
import { stripBranchWorktreeMetadata, worktreeStatesFromBranchReadModel } from '#/web/stores/repos/worktree-state.ts'
import type { RepoBranchState, RepoState, RepoWorktreeState } from '#/web/stores/repos/types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/web/types.ts'

export interface RepoBranchReadModelData {
  branches: RepoBranchState[]
  currentBranch: string
  currentHEAD?: string
  status: WorktreeStatus[]
  worktreesByPath: Record<string, RepoWorktreeState>
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
  status: WorktreeStatus[],
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
  const projectionReadModel = useRepoProjectionReadModel(repoRoot, repoInstanceId, null, 'full', enabled)
  if (!enabled) return null
  const projection = projectionReadModel.data
  if (!projection?.snapshot) return null
  return repoBranchReadModelFromSnapshot(projection.snapshot, projection.status)
}

export function readRepoBranchQueryProjection(
  repo: Pick<RepoState, 'id' | 'instanceId'>,
  queryClient?: QueryClient,
): RepoBranchReadModelData | null {
  const projection = getRepoProjectionQueryData(repo.id, repo.instanceId, null, 'full', queryClient)
  if (projection?.snapshot) return repoBranchReadModelFromSnapshot(projection.snapshot, projection.status)
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
