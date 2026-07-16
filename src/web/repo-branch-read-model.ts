import type { QueryClient } from '@tanstack/react-query'
import {
  getRepoProjectionPlaceholderData,
  getRepoProjectionQueryData,
  getRepoWorktreeStatusQueryData,
  useRepoProjectionReadModel,
  useRepoWorktreeStatusReadModel,
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
  repoRuntimeId: string,
  enabled: boolean,
): RepoBranchReadModelData | null {
  const projectionReadModel = useRepoProjectionReadModel(repoRoot, repoRuntimeId, null, 'full', enabled)
  const statusReadModel = useRepoWorktreeStatusReadModel(repoRoot, repoRuntimeId, enabled)
  if (!enabled) return null
  const projection = projectionReadModel.data
  if (!projection?.snapshot) return null
  if (!statusReadModel.data) return null
  return repoBranchReadModelFromSnapshot(projection.snapshot, statusReadModel.data.status)
}

export function readRepoBranchQueryProjection(
  repo: Pick<RepoState, 'id' | 'repoRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchReadModelData | null {
  const projection =
    getRepoProjectionQueryData(repo.id, repo.repoRuntimeId, null, 'full', queryClient) ??
    getRepoProjectionPlaceholderData(repo.id, repo.repoRuntimeId, null, 'full', queryClient)
  const status = getRepoWorktreeStatusQueryData(repo.id, repo.repoRuntimeId, queryClient)
  if (projection?.snapshot && status) return repoBranchReadModelFromSnapshot(projection.snapshot, status.status)
  return null
}

export function readRepoBranchSnapshotQueryProjection(
  repo: Pick<RepoState, 'id' | 'repoRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchSnapshotData | null {
  const projection =
    getRepoProjectionQueryData(repo.id, repo.repoRuntimeId, null, 'full', queryClient) ??
    getRepoProjectionPlaceholderData(repo.id, repo.repoRuntimeId, null, 'full', queryClient)
  return projection?.snapshot ? repoBranchSnapshotDataFromSnapshot(projection.snapshot) : null
}

export function requireRepoBranchQueryProjection(
  repo: Pick<RepoState, 'id' | 'repoRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchReadModelData {
  const projection = readRepoBranchQueryProjection(repo, queryClient)
  if (!projection) throw new Error(`repo branch read model query data unavailable for repo: ${repo.id}`)
  return projection
}
