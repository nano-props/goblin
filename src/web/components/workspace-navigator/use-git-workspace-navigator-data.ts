// Shared data layer for every Git workspace navigator surface.

import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { BranchViewMode } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  useRepoOperationsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoOperationState } from '#/web/stores/workspaces/operations.ts'

export type GitWorkspaceNavigatorRepo = BranchActionRepo

type GitWorkspaceNavigatorDataRepo = GitWorkspaceNavigatorRepo & { branchViewMode: BranchViewMode }

export interface GitWorkspaceNavigatorRepoShell {
  id: WorkspaceId
  workspaceRuntimeId: string
  branchViewMode: BranchViewMode
  branchAction: RepoOperationState
  remoteLifecycle: BranchActionRepo['remoteLifecycle']
}

export function useGitWorkspaceNavigatorReadModel(repoShell: MaybeRefOrGetter<GitWorkspaceNavigatorRepoShell>) {
  const operationsReadModel = useRepoOperationsReadModel(
    () => toValue(repoShell).id,
    () => toValue(repoShell).workspaceRuntimeId,
  )
  const snapshotReadModel = useRepoSnapshotReadModel(
    () => toValue(repoShell).id,
    () => toValue(repoShell).workspaceRuntimeId,
  )
  const statusReadModel = useRepoWorktreeStatusReadModel(
    () => toValue(repoShell).id,
    () => toValue(repoShell).workspaceRuntimeId,
  )

  const repo = computed<GitWorkspaceNavigatorDataRepo | undefined>(() => {
    const shell = toValue(repoShell)
    const snapshot = snapshotReadModel.data.value?.snapshot
    if (!snapshot) return undefined
    const projected = projectBranchActionRepo(
      {
        id: shell.id,
        workspaceRuntimeId: shell.workspaceRuntimeId,
        snapshot,
        status: statusReadModel.data.value?.status,
        operations: { branchAction: shell.branchAction },
        remoteLifecycle: shell.remoteLifecycle,
      },
      operationsReadModel.data.value?.operations,
    )
    return {
      id: projected.id,
      workspaceRuntimeId: projected.workspaceRuntimeId,
      snapshot: projected.snapshot,
      status: projected.status,
      branchAction: projected.branchAction,
      remoteLifecycle: projected.remoteLifecycle,
      branchViewMode: shell.branchViewMode,
    }
  })

  return { repo, snapshotReadModel, statusReadModel }
}
