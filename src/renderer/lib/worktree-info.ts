import type { BranchInfo } from '#/renderer/types.ts'
import { tildify } from '#/renderer/lib/paths.ts'

interface WorktreeInfoRepo {
  id: string
}

export function formatWorktreeInfo(repo: WorktreeInfoRepo, branch: BranchInfo): string {
  return [
    `Repository root: ${tildify(repo.id)}`,
    `Worktree path: ${tildify(branch.worktreePath ?? '')}`,
    `Worktree branch: ${branch.name}`,
    `Dirty: ${branch.worktreeDirty ? 'yes' : branch.worktreeDirty === false ? 'no' : 'unknown'}`,
  ].join('\n')
}
