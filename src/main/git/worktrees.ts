import { git } from '#/main/git/helper.ts'
import { parseStatus, parseWorktrees } from '#/main/git/parsers.ts'
import type { WorktreeInfo } from '#/main/git/types.ts'

export async function getWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  try {
    const output = await git(cwd, ['worktree', 'list', '--porcelain'])
    const worktrees = parseWorktrees(output)

    await Promise.all(
      worktrees.map(async (wt) => {
        if (wt.isBare) return
        try {
          // -z so a filename containing a literal newline doesn't get
          // counted as two changes. Reuse parseStatus so rename / copy
          // pairs (R/C take TWO records under -z) collapse into one
          // entry — matching what `git status` shows the user.
          const out = await git(wt.path, ['status', '--porcelain', '-z'])
          const entries = parseStatus(out)
          wt.isDirty = entries.length > 0
          wt.changeCount = entries.length
        } catch {
          wt.isDirty = undefined
        }
      }),
    )

    return worktrees
  } catch {
    return []
  }
}
