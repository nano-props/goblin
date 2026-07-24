import type { QueryClient } from '@tanstack/react-query'
import {
  getRepoProjectionQueryData,
  getRepoWorktreeStatusQueryData,
  getSuccessfulRepoProjectionQueryData,
} from '#/web/repo-query-cache.ts'
import { useRepoProjectionReadModel, useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import {
  stripBranchWorktreeMetadata,
  worktreeStatesFromBranchReadModel,
} from '#/web/stores/workspaces/worktree-state.ts'
import type { RepoBranchState, WorkspaceState, RepoWorktreeState } from '#/web/stores/workspaces/types.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/web/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

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
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  enabled: boolean,
): RepoBranchReadModelData | null {
  const projectionReadModel = useRepoProjectionReadModel(repoRoot, workspaceRuntimeId, null, 'full', enabled)
  const statusReadModel = useRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, enabled)
  if (!enabled) return null
  const projection = projectionReadModel.data
  if (!projection?.snapshot) return null
  if (!statusReadModel.data) return null
  return repoBranchReadModelFromSnapshot(projection.snapshot, statusReadModel.data.status)
}

export function readRepoBranchQueryProjection(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchReadModelData | null {
  const projection = getRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, null, 'full', queryClient)
  const status = getRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId, queryClient)
  if (projection?.snapshot && status) return repoBranchReadModelFromSnapshot(projection.snapshot, status.status)
  return null
}

export function readRepoBranchSnapshotQueryProjection(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchSnapshotData | null {
  const projection = getRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, null, 'full', queryClient)
  return projection?.snapshot ? repoBranchSnapshotDataFromSnapshot(projection.snapshot) : null
}

export function readSuccessfulRepoBranchSnapshotQueryProjection(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchSnapshotData | null {
  const projection = getSuccessfulRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, null, 'full', queryClient)
  return projection?.snapshot ? repoBranchSnapshotDataFromSnapshot(projection.snapshot) : null
}

export function requireRepoBranchSnapshotQueryProjection(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  queryClient?: QueryClient,
): RepoBranchSnapshotData {
  const projection = readRepoBranchSnapshotQueryProjection(repo, queryClient)
  if (!projection) throw new Error(`repo branch snapshot query data unavailable for repo: ${repo.id}`)
  return projection
}
