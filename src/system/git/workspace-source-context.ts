import path from 'node:path'
import type { RepoWorktreeSnapshot, WorkspaceRepoWorktreeSnapshot, WorktreeInfo } from '#/shared/git-types.ts'
import { resolveGitWorkspacePath } from '#/system/git/branches.ts'
import { readRepoWorktreeSnapshots } from '#/system/git/worktree-state.ts'
import { readWorktreeMembership } from '#/system/git/worktrees.ts'

export interface LocalGitWorkspaceSourceContext {
  sourceWorktree: WorktreeInfo
  worktrees: RepoWorktreeSnapshot[]
  workspaceWorktrees: WorkspaceRepoWorktreeSnapshot[]
}

/** Reads and validates one authoritative local source-worktree projection. */
export async function readLocalGitWorkspaceSourceContext(
  workspacePath: string,
  signal?: AbortSignal,
): Promise<LocalGitWorkspaceSourceContext> {
  const membership = await readWorktreeMembership(workspacePath, signal)
  signal?.throwIfAborted()
  const [sourcePath, worktrees] = await Promise.all([
    resolveGitWorkspacePath(workspacePath, { signal }),
    readRepoWorktreeSnapshots(workspacePath, membership, signal),
  ])
  const normalizedSourcePath = path.normalize(sourcePath)
  const sourceWorktree = membership.find((worktree) => path.normalize(worktree.path) === normalizedSourcePath)
  if (!sourceWorktree) throw new Error('error.failed-read-repo')
  const normalizedSourceWorktreePath = path.normalize(sourceWorktree.path)
  return {
    sourceWorktree,
    worktrees,
    workspaceWorktrees: worktrees.map((worktree) => ({
      ...worktree,
      isSource: path.normalize(worktree.path) === normalizedSourceWorktreePath,
    })),
  }
}
