import path from 'node:path'
import type { RepoFileViewerResult } from '#/shared/api-types.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { resolveRemoteRepoTarget } from '#/server/modules/repo-source.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { remoteCommandExists } from '#/system/ssh/git.ts'
import { userShellCommandExists } from '#/system/user-shell.ts'

const CAT_VIEWER: RepoFileViewerResult = { viewer: 'cat' }

export async function getRepositoryFileViewer(
  cwd: string,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<RepoFileViewerResult> {
  if (signal?.aborted || !hasUsableWorktreePath(worktreePath)) return CAT_VIEWER

  if (isRemoteRepoId(cwd)) {
    const target = await resolveRemoteRepoTarget(cwd)
    const hasBat = await remoteCommandExists(target, worktreePath, 'bat', { signal })
    return hasBat ? { viewer: 'bat' } : CAT_VIEWER
  }

  const worktrees = await getWorktrees(cwd, { includeStatus: false, signal })
  if (!matchesKnownWorktree(worktrees, worktreePath)) return CAT_VIEWER

  const hasBat = await userShellCommandExists('bat', worktreePath, signal)
  return hasBat ? { viewer: 'bat' } : CAT_VIEWER
}

function hasUsableWorktreePath(worktreePath: string): boolean {
  return worktreePath.length > 0 && !worktreePath.includes('\0')
}

function matchesKnownWorktree(worktrees: ReadonlyArray<WorktreeInfo>, worktreePath: string): boolean {
  const resolved = path.resolve(worktreePath)
  for (const wt of worktrees) {
    if (wt.isBare) continue
    if (path.resolve(wt.path) === resolved) return true
  }
  return false
}
