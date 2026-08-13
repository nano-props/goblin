import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { GitOperation, RepoWorktreeSnapshot, WorktreeInfo } from '#/shared/git-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { git } from '#/system/git/git-exec.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'

const WORKTREE_STATE_READ_CONCURRENCY = 4

export async function readRepoWorktreeSnapshots(
  worktrees: readonly WorktreeInfo[],
  signal?: AbortSignal,
): Promise<RepoWorktreeSnapshot[]> {
  return await mapWithConcurrency(
    worktrees.filter((worktree) => !worktree.isBare),
    WORKTREE_STATE_READ_CONCURRENCY,
    async (worktree) => await readRepoWorktreeSnapshot(worktree, signal),
    { signal, abort: 'throw' },
  )
}

async function readRepoWorktreeSnapshot(worktree: WorktreeInfo, signal?: AbortSignal): Promise<RepoWorktreeSnapshot> {
  if (worktree.isPrunable || !worktree.headOid) {
    throw new Error('Git returned an incomplete worktree identity')
  }
  return {
    path: worktree.path,
    head: gitHead(worktree.branch ?? null),
    headOid: worktree.headOid,
    operation: await readGitOperationForProjection(worktree.path, signal),
    isPrimary: worktree.isPrimary,
    isLocked: worktree.isLocked ?? false,
  }
}

async function readGitOperationForProjection(cwd: string, signal?: AbortSignal): Promise<GitOperation | null> {
  try {
    return await readGitOperation(cwd, signal)
  } catch (error) {
    signal?.throwIfAborted()
    return null
  }
}

export async function readGitOperation(cwd: string, signal?: AbortSignal): Promise<GitOperation | null> {
  const paths = await Promise.all(
    ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'MERGE_HEAD'].map(
      async (gitPath) => resolveGitPath(cwd, gitPath, signal),
    ),
  )
  signal?.throwIfAborted()
  const [rebaseMergePath, rebaseApplyPath, cherryPickPath, revertPath, bisectPath, mergePath] = paths
  const rebasePath = (await pathExists(rebaseMergePath))
    ? rebaseMergePath
    : (await pathExists(rebaseApplyPath))
      ? rebaseApplyPath
      : null
  if (rebasePath) return { kind: 'rebase', branchName: await readRebaseBranchName(rebasePath) }
  if (await pathExists(cherryPickPath)) return { kind: 'cherry-pick' }
  if (await pathExists(revertPath)) return { kind: 'revert' }
  if (await pathExists(bisectPath)) return { kind: 'bisect' }
  if (await pathExists(mergePath)) return { kind: 'merge' }
  return null
}

async function resolveGitPath(cwd: string, gitPath: string, signal?: AbortSignal): Promise<string> {
  const resolved = await git(cwd, ['rev-parse', '--git-path', gitPath], { signal })
  if (!resolved) throw new Error('Git returned an empty administrative path')
  return path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(cwd, resolved)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

async function readRebaseBranchName(rebasePath: string): Promise<string | null> {
  try {
    const value = (await readFile(path.join(rebasePath, 'head-name'), 'utf8')).trim()
    const branchName = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : ''
    return isSafeBranchName(branchName) ? branchName : null
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}
