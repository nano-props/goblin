// Confirmation dispatches use the dialog's explicit repo and branch payload,
// which may differ from the currently selected branch.

import {
  deleteBranchNeedsForceConfirm,
  dispatchRepoBranchAction,
  removeWorktreeNeedsForceConfirm,
} from '#/web/stores/workspaces/branch-action-write-paths.ts'
import {
  branchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoMutationExecResult } from '#/shared/git-types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { getRepoSnapshotQueryData, getRepoWorktreeStatusQueryData } from '#/web/repos/query-cache.ts'

interface BranchActionDispatchContext {
  repo: BranchActionRepo
}

export function dispatchDeleteBranch({
  repo,
  branchName,
  force,
  deleteUpstream,
}: BranchActionDispatchContext & {
  branchName: string
  force: boolean
  deleteUpstream: boolean
}): Promise<RepoMutationExecResult | null> {
  const actionRepo = repoForBranchActionDispatch(repo)
  if (!actionRepo) return Promise.resolve(recordRepoDataUnavailable(repo))
  return dispatchRepoBranchAction(
    actionRepo.id,
    actionRepo.workspaceRuntimeId,
    { kind: 'deleteBranch', branch: branchName, force, deleteUpstream },
    workspacesStore.getState().runBranchAction,
    {
      deferResultMessages: force ? [] : ['error.branch-not-fully-merged'],
      handleResult: (result) => {
        if (deleteBranchNeedsForceConfirm(result, force)) {
          branchActionDialogsStore.getState().openForceDeleteConfirm({
            repoId: actionRepo.id,
            branchName,
            payload: branchName,
          })
          return true
        }
        return false
      },
    },
  )
}

export function dispatchRemoveWorktree({
  repo,
  target,
  deleteBranch,
  forceDeleteBranch,
  deleteUpstream,
}: BranchActionDispatchContext & {
  target: RemoveWorktreeDialogPayload
  deleteBranch: boolean
  forceDeleteBranch: boolean
  deleteUpstream: boolean
}): Promise<RepoMutationExecResult | null> {
  const actionRepo = repoForBranchActionDispatch(repo)
  if (!actionRepo) return Promise.resolve(recordRepoDataUnavailable(repo))
  return dispatchRepoBranchAction(
    actionRepo.id,
    actionRepo.workspaceRuntimeId,
    {
      kind: 'removeWorktree',
      branch: target.branch,
      worktreePath: target.path,
      deleteBranch,
      forceDeleteBranch,
      deleteUpstream,
    },
    workspacesStore.getState().runBranchAction,
    {
      deferResultMessages: deleteBranch && !forceDeleteBranch ? ['error.cannot-remove-unpushed-worktree'] : [],
      handleResult: (result) => {
        if (removeWorktreeNeedsForceConfirm(result, deleteBranch, forceDeleteBranch)) {
          branchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
            repoId: actionRepo.id,
            branchName: target.branch,
            payload: target,
          })
          return true
        }
        return false
      },
    },
  )
}

// The dialog confirmation has already cleared the protected-branch gate.
export function dispatchPush({
  repo,
  branchName,
}: BranchActionDispatchContext & { branchName: string }): Promise<RepoMutationExecResult | null> {
  const actionRepo = repoForBranchActionDispatch(repo)
  if (!actionRepo) return Promise.resolve(recordRepoDataUnavailable(repo))
  return dispatchRepoBranchAction(
    actionRepo.id,
    actionRepo.workspaceRuntimeId,
    { kind: 'push', branch: branchName },
    workspacesStore.getState().runBranchAction,
  )
}

function repoForBranchActionDispatch(repo: BranchActionRepo): BranchActionRepo | null {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
  if (!snapshot) return null
  const status = getRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId)?.status
  return {
    ...repo,
    snapshot,
    status,
  }
}

function recordRepoDataUnavailable(repo: BranchActionRepo): RepoMutationExecResult {
  const result = { ok: false as const, message: 'error.failed-read-repo' }
  workspacesStore.getState().setLastResult(repo.id, result, repo.workspaceRuntimeId)
  return result
}
