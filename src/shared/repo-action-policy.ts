// Single source of truth for the policy-style guards that gate destructive
// repo actions. Callers pass already-validated primitives (branch name,
// current branch, worktree metadata) and these helpers return either
// null (allowed) or an `ExecResult` shape the IPC layer can hand back to
// the renderer without translation.

import { PROTECTED_BRANCHES, type ExecResult, type WorktreeInfo } from '#/shared/git-types.ts'

export type BranchDeletionNotMergedMessage = 'error.branch-not-fully-merged' | 'error.cannot-remove-unpushed-worktree'

export function validateRemovableWorktreeState(worktree: WorktreeInfo): ExecResult | null {
  if (worktree.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }
  if (worktree.isDirty !== false) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }
  return null
}

export function validateBranchDeletionPolicy(input: {
  branch: string
  currentBranch?: string
  isCheckedOutElsewhere?: boolean
  force?: boolean
  mergedToCurrent?: boolean
  mergedToUpstream?: boolean
  notMergedMessage?: BranchDeletionNotMergedMessage
}): ExecResult | null {
  if (input.branch === input.currentBranch) return { ok: false, message: 'error.cannot-delete-current-branch' }
  if (PROTECTED_BRANCHES.has(input.branch)) return { ok: false, message: 'error.cannot-delete-protected-branch' }
  if (input.isCheckedOutElsewhere) return { ok: false, message: 'error.cannot-delete-checked-out-branch' }
  if (!input.force && !input.mergedToCurrent && !input.mergedToUpstream) {
    return { ok: false, message: input.notMergedMessage ?? 'error.branch-not-fully-merged' }
  }
  return null
}
