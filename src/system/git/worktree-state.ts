import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { GitOperation, RepoWorktreeSnapshot, WorktreeInfo } from '#/shared/git-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { git } from '#/system/git/git-exec.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'

const WORKTREE_STATE_READ_CONCURRENCY = 4
const GIT_OPERATION_PATHS = [
  'rebase-merge',
  'rebase-apply',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'BISECT_START',
  'MERGE_HEAD',
] as const

interface GitWorktreeState {
  operation: GitOperation | null
  materializedBranch: string | null
}

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
  const head = gitHead(worktree.branch ?? null)
  const state = await readGitWorktreeState(worktree.path, signal)
  return {
    path: worktree.path,
    head,
    headOid: worktree.headOid,
    operation: state.operation,
    materializedBranch: head.kind === 'branch' ? head.branchName : state.materializedBranch,
    isPrimary: worktree.isPrimary,
    isLocked: worktree.isLocked ?? false,
  }
}

export async function readGitWorktreeState(cwd: string, signal?: AbortSignal): Promise<GitWorktreeState> {
  const paths = await resolveGitPaths(cwd, signal)
  signal?.throwIfAborted()
  const [rebaseMergePath, rebaseApplyPath, cherryPickPath, revertPath, bisectPath, bisectStartPath, mergePath] = paths
  const rebasePath = (await pathIsDirectory(rebaseMergePath))
    ? rebaseMergePath
    : (await pathIsDirectory(rebaseApplyPath))
      ? rebaseApplyPath
      : null
  const [rebaseBranch, bisectActive, cherryPickActive, revertActive, mergeActive] = await Promise.all([
    rebasePath ? readRebaseBranchName(rebasePath) : null,
    pathExists(bisectPath),
    pathExists(cherryPickPath),
    pathExists(revertPath),
    pathExists(mergePath),
  ])
  const operation: GitOperation | null = rebasePath
    ? { kind: 'rebase' }
    : cherryPickActive
      ? { kind: 'cherry-pick' }
      : revertActive
        ? { kind: 'revert' }
        : mergeActive
          ? { kind: 'merge' }
          : bisectActive
            ? { kind: 'bisect' }
            : null
  return {
    operation,
    materializedBranch: rebaseBranch ?? (bisectActive ? await readBisectBranchName(bisectStartPath) : null),
  }
}

async function resolveGitPaths(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const args = ['rev-parse', ...GIT_OPERATION_PATHS.flatMap((gitPath) => ['--git-path', gitPath])]
  const output = await git(cwd, args, { signal })
  const resolvedPaths = output.split(/\r?\n/)
  if (resolvedPaths.length !== GIT_OPERATION_PATHS.length || resolvedPaths.some((resolved) => !resolved)) {
    throw new Error(`Git returned ${resolvedPaths.length} administrative paths; expected ${GIT_OPERATION_PATHS.length}`)
  }
  return resolvedPaths.map((resolved) =>
    path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(cwd, resolved),
  )
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

async function pathIsDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
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

async function readBisectBranchName(bisectStartPath: string): Promise<string | null> {
  try {
    return parseOperationBranchName((await readFile(bisectStartPath, 'utf8')).trim())
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

function parseOperationBranchName(value: string): string | null {
  const branchName = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value
  if (/^[0-9a-f]{40,64}$/i.test(branchName)) return null
  return isSafeBranchName(branchName) ? branchName : null
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}
