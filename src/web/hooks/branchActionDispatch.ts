// Standalone dispatch functions for branch action confirmations.
//
// These were previously inlined into `useBranchActions`, where the
// `(repo, branch)` for the IPC call was captured by closure from the
// hook call site. That coupling was fine when the host and the request
// were in the same React subtree, but the layout-level `BranchActionDialogHost`
// needs to dispatch a confirmation against the dialog payload's
// `(repo, branch)` — not the host's `(repo, branch)` — so the user can
// open a dialog for a non-selected branch (e.g. a row in the zen-mode
// HoverCard popover).
//
// Each function takes the resolved `repo` and `branch` explicitly,
// plus the dialog payload, and **returns the IPC promise** rather than
// dropping it. The host's `onConfirm` returns this promise to
// `useAsyncPending.run`, which then marks the Confirm button as
// `aria-busy` and rejects duplicate clicks for the duration of the IPC
// round-trip. The force-promote callbacks dispatch back into
// `useBranchActionDialogsStore` to open the follow-up confirm dialog
// with the same payload.

import {
  deleteBranchNeedsForceConfirm,
  dispatchRepoBranchAction,
  removeWorktreeNeedsForceConfirm,
} from '#/web/stores/repos/branch-action-write-paths.ts'
import {
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { ExecResult } from '#/web/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { closeWorkspacePaneTabsForWorktree } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { getRepoSnapshotQueryData, getRepoStatusQueryData } from '#/web/repo-data-query.ts'

interface BranchActionDispatchContext {
  repo: BranchActionRepo
}

/**
 * Dispatch a `deleteBranch` action against the resolved repo. Mirrors
 * the pre-PR `useBranchActions.deleteBranch` private function, but
 * takes `repo` explicitly so the host can pass the repo looked up
 * from the dialog payload (which may differ from the host's own
 * `(repo, branch)` when the dialog was opened for a non-selected
 * branch row).
 */
export function dispatchDeleteBranch({
  repo,
  branchName,
  force,
  alsoDeleteUpstream,
}: BranchActionDispatchContext & {
  branchName: string
  force: boolean
  alsoDeleteUpstream: boolean
}): Promise<ExecResult | null> {
  const actionRepo = repoForBranchActionDispatch(repo)
  return dispatchRepoBranchAction(
    actionRepo.id,
    actionRepo.instanceId,
    { kind: 'deleteBranch', branch: branchName, force, alsoDeleteUpstream },
    useReposStore.getState().runBranchAction,
    {
      deferResultMessages: force ? [] : ['error.branch-not-fully-merged'],
      handleResult: (result) => {
        if (deleteBranchNeedsForceConfirm(result, force)) {
          useBranchActionDialogsStore.getState().openForceDeleteConfirm({
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

/**
 * Dispatch a `removeWorktree` action against the resolved repo. See
 * `dispatchDeleteBranch` for why this lives outside the hook.
 */
export async function dispatchRemoveWorktree({
  repo,
  target,
  alsoDeleteBranch,
  forceDeleteBranch,
  alsoDeleteUpstream,
}: BranchActionDispatchContext & {
  target: RemoveWorktreeDialogPayload
  alsoDeleteBranch: boolean
  forceDeleteBranch: boolean
  alsoDeleteUpstream: boolean
}): Promise<ExecResult | null> {
  const actionRepo = repoForBranchActionDispatch(repo)
  const preflightFailure = removeWorktreePreflightFailure(actionRepo, target)
  if (preflightFailure) {
    recordRemoveWorktreeResult(actionRepo, target, alsoDeleteBranch, preflightFailure)
    return preflightFailure
  }
  const tabsClosed = await closeWorkspacePaneTabsForWorktree({
    repoId: actionRepo.id,
    branchName: target.branch,
    worktreePath: target.path,
  })
  if (!tabsClosed) {
    const result = { ok: false as const, message: 'error.workspace-tab-close-failed' }
    recordRemoveWorktreeResult(actionRepo, target, alsoDeleteBranch, result)
    return result
  }
  return await dispatchRepoBranchAction(
    actionRepo.id,
    actionRepo.instanceId,
    {
      kind: 'removeWorktree',
      branch: target.branch,
      worktreePath: target.path,
      alsoDeleteBranch,
      forceDeleteBranch,
      alsoDeleteUpstream,
    },
    useReposStore.getState().runBranchAction,
    {
      deferResultMessages: alsoDeleteBranch && !forceDeleteBranch ? ['error.cannot-remove-unpushed-worktree'] : [],
      handleResult: (result) => {
        if (removeWorktreeNeedsForceConfirm(result, alsoDeleteBranch, forceDeleteBranch)) {
          useBranchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
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

function removeWorktreePreflightFailure(
  repo: BranchActionRepo,
  target: RemoveWorktreeDialogPayload,
): ExecResult | null {
  const worktree = repo.data.worktreesByPath[target.path]
  if (!worktree) return null
  if (worktree.isMain) return { ok: false, message: 'error.cannot-remove-main-worktree' }
  if (worktree.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }
  if (worktree.isDirty === true) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }
  return null
}

function recordRemoveWorktreeResult(
  repo: BranchActionRepo,
  target: RemoveWorktreeDialogPayload,
  alsoDeleteBranch: boolean,
  result: ExecResult,
): void {
  useReposStore.getState().setLastResult(repo.id, result, repo.instanceId, {
    action: {
      kind: 'removeWorktree',
      branch: target.branch,
      worktreePath: target.path,
      alsoDeleteBranch,
    },
  })
}

/**
 * Dispatch a `push` action, bypassing the protected-branch confirm
 * gate (the user has already cleared it by confirming the dialog).
 */
export function dispatchPush({
  repo,
  branchName,
}: BranchActionDispatchContext & { branchName: string }): Promise<ExecResult | null> {
  const actionRepo = repoForBranchActionDispatch(repo)
  return dispatchRepoBranchAction(
    actionRepo.id,
    actionRepo.instanceId,
    { kind: 'push', branch: branchName },
    useReposStore.getState().runBranchAction,
  )
}

function repoForBranchActionDispatch(repo: BranchActionRepo): BranchActionRepo {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.instanceId)
  if (!snapshot) return repo
  const readModel = repoBranchReadModelFromSnapshot(snapshot, {
    status: getRepoStatusQueryData(repo.id, repo.instanceId) ?? repo.data.status,
    worktreesByPath: repo.data.worktreesByPath,
  })
  return {
    ...repo,
    data: {
      ...repo.data,
      currentBranch: readModel.currentBranch,
      worktreesByPath: readModel.worktreesByPath,
    },
  }
}
