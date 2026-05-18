import type { BranchInfo } from '#/renderer/types.ts'

interface WorktreeInfoRepo {
  id: string
}

export function formatWorktreeInfo(repo: WorktreeInfoRepo, branch: BranchInfo): string {
  return [
    'Git worktree',
    '',
    `Repository root: ${repo.id}`,
    `Worktree path: ${branch.worktreePath ?? ''}`,
    `Worktree branch: ${branch.name}`,
    `Dirty: ${branch.worktreeDirty ? 'yes' : branch.worktreeDirty === false ? 'no' : 'unknown'}`,
  ].join('\n')
}
