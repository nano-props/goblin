import type { GitOperation, RepoWorktreeSnapshot } from '#/shared/git-types.ts'

export type WorktreePresentationTranslator = (key: string, params?: Record<string, string | number>) => string

const WORKTREE_OPERATION_KEYS = {
  rebase: 'worktree-state.rebase',
  merge: 'worktree-state.merge',
  'cherry-pick': 'worktree-state.cherry-pick',
  revert: 'worktree-state.revert',
  bisect: 'worktree-state.bisect',
} as const

export function worktreeOperationKey(operation: GitOperation): (typeof WORKTREE_OPERATION_KEYS)[GitOperation['kind']] {
  return WORKTREE_OPERATION_KEYS[operation.kind]
}

export function worktreePresentationLabel(worktree: RepoWorktreeSnapshot, t: WorktreePresentationTranslator): string {
  if (worktree.head.kind === 'branch' && !worktree.operation) return worktree.head.branchName
  const operation = worktree.operation
  if (!operation) return worktree.headOid?.slice(0, 7) ?? worktree.path
  if (operation.kind === 'rebase') {
    return worktree.materializedBranch
      ? t('worktree-state.rebase-branch', { branch: worktree.materializedBranch })
      : t('worktree-state.rebase')
  }
  return t(worktreeOperationKey(operation))
}
