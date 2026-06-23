// Standalone dispatch functions for branch action confirmations.
//
// These were previously inlined into `useBranchActions`, where the
// `(repo, branch)` for the IPC call was captured by closure from the
// hook call site. That coupling was fine when the host and the request
// were in the same React subtree, but the layout-level `BranchActionDialogHost`
// needs to dispatch a confirmation against the dialog payload's
// `(repo, branch)` — not the host's `(repo, branch)` — so the user can
// open a dialog for a non-selected branch (e.g. a row in the focus-mode
// HoverCard popover).
//
// Each function is pure: it takes the resolved `repo` and `branch`
// explicitly, plus the dialog payload. The force-promote callbacks
// dispatch back into `useBranchActionDialogsStore` to open the follow-up
// confirm dialog with the same payload.

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
import { useReposStore } from '#/web/stores/repos/store.ts'

export interface BranchActionDispatchContext {
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
}): void {
  void dispatchRepoBranchAction(
    repo.id,
    repo.instanceToken,
    { kind: 'deleteBranch', branch: branchName, force, alsoDeleteUpstream },
    useReposStore.getState().runBranchAction,
    {
      deferResultMessages: force ? [] : ['error.branch-not-fully-merged'],
      handleResult: (result) => {
        if (deleteBranchNeedsForceConfirm(result, force)) {
          useBranchActionDialogsStore.getState().openForceDeleteConfirm({
            repoId: repo.id,
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
export function dispatchRemoveWorktree({
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
}): void {
  void dispatchRepoBranchAction(
    repo.id,
    repo.instanceToken,
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
      deferResultMessages:
        alsoDeleteBranch && !forceDeleteBranch ? ['error.cannot-remove-unpushed-worktree'] : [],
      handleResult: (result) => {
        if (removeWorktreeNeedsForceConfirm(result, alsoDeleteBranch, forceDeleteBranch)) {
          useBranchActionDialogsStore.getState().openForceRemoveWorktreeConfirm({
            repoId: repo.id,
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

/**
 * Dispatch a `push` action, bypassing the protected-branch confirm
 * gate (the user has already cleared it by confirming the dialog).
 */
export function dispatchPush({ repo, branchName }: BranchActionDispatchContext & { branchName: string }): void {
  void dispatchRepoBranchAction(
    repo.id,
    repo.instanceToken,
    { kind: 'push', branch: branchName },
    useReposStore.getState().runBranchAction,
  )
}