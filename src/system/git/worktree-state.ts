import path from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'
import { gitOperationRequiresDetachedHead, hasUniqueRepoWorktreeMaterializedBranches } from '#/shared/git-types.ts'
import type { GitOperation, RepoWorktreeSnapshot, WorktreeInfo } from '#/shared/git-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { git } from '#/system/git/git-exec.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import { resolveRepoCommonDir } from '#/system/git/branches.ts'

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
  repoCwd: string,
  worktrees: readonly WorktreeInfo[],
  signal?: AbortSignal,
): Promise<RepoWorktreeSnapshot[]> {
  const usableWorktrees = worktrees.filter((worktree) => !worktree.isBare)
  if (usableWorktrees.length === 0) return []
  const gitDirs = await resolveWorktreeGitDirs(repoCwd, worktrees, signal)
  const snapshots = await mapWithConcurrency(
    usableWorktrees,
    WORKTREE_STATE_READ_CONCURRENCY,
    async (worktree) => await readRepoWorktreeSnapshot(repoCwd, worktree, requiredGitDir(gitDirs, worktree), signal),
    { signal, abort: 'throw' },
  )
  if (!hasUniqueRepoWorktreeMaterializedBranches(snapshots)) {
    throw new Error('Git returned duplicate materialized worktree branches')
  }
  return snapshots
}

async function readRepoWorktreeSnapshot(
  repoCwd: string,
  worktree: WorktreeInfo,
  gitDir: string,
  signal?: AbortSignal,
): Promise<RepoWorktreeSnapshot> {
  if (worktree.isPrunable || worktree.headOid === undefined) {
    throw new Error('Git returned an incomplete worktree identity')
  }
  const head = gitHead(worktree.branch ?? null)
  const state = await readGitWorktreeState(repoCwd, gitDir, signal)
  if (head.kind === 'branch' && gitOperationRequiresDetachedHead(state.operation)) {
    throw new Error('Git worktree membership changed while reading operation state')
  }
  if (worktree.headOid === null && (head.kind !== 'branch' || state.operation !== null)) {
    throw new Error('Git returned an invalid unborn worktree identity')
  }
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

export async function readGitWorktreeState(
  repoCwd: string,
  gitDir: string,
  signal?: AbortSignal,
): Promise<GitWorktreeState> {
  const paths = await resolveGitPaths(repoCwd, gitDir, signal)
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
    materializedBranch:
      rebaseBranch ?? (bisectActive ? await readBisectBranchName(repoCwd, gitDir, bisectStartPath, signal) : null),
  }
}

async function resolveGitPaths(repoCwd: string, gitDir: string, signal?: AbortSignal): Promise<string[]> {
  const args = ['--git-dir', gitDir, 'rev-parse', ...GIT_OPERATION_PATHS.flatMap((gitPath) => ['--git-path', gitPath])]
  const output = await git(repoCwd, args, { signal })
  const resolvedPaths = output.split(/\r?\n/)
  if (resolvedPaths.length !== GIT_OPERATION_PATHS.length || resolvedPaths.some((resolved) => !resolved)) {
    throw new Error(`Git returned ${resolvedPaths.length} administrative paths; expected ${GIT_OPERATION_PATHS.length}`)
  }
  return resolvedPaths.map((resolved) =>
    path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(repoCwd, resolved),
  )
}

async function resolveWorktreeGitDirs(
  repoCwd: string,
  worktrees: readonly WorktreeInfo[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const commonDir = await resolveRepoCommonDir(repoCwd, { signal })
  signal?.throwIfAborted()
  const primaryWorktrees = worktrees.filter((worktree) => worktree.isPrimary)
  if (primaryWorktrees.length !== 1) throw new Error('Git returned an invalid primary worktree identity')
  const gitDirs = new Map([[worktreePathKey(primaryWorktrees[0]!.path), commonDir]])
  const linkedWorktrees = worktrees.filter((worktree) => !worktree.isPrimary)
  if (linkedWorktrees.length === 0) return gitDirs
  const linkedWorktreeKeys = new Set(linkedWorktrees.map((worktree) => worktreePathKey(worktree.path)))

  const adminRoot = path.join(commonDir, 'worktrees')
  const entries = await readdir(adminRoot, { withFileTypes: true })
  signal?.throwIfAborted()
  const linkedGitDirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => await linkedWorktreeGitDir(path.join(adminRoot, entry.name), signal)),
  )
  signal?.throwIfAborted()
  for (const candidate of linkedGitDirs) {
    if (!candidate) continue
    const { worktreePath, gitDir } = candidate
    const key = worktreePathKey(worktreePath)
    if (!linkedWorktreeKeys.has(key)) continue
    if (gitDirs.has(key)) throw new Error('Git returned duplicate worktree administrative identities')
    gitDirs.set(key, gitDir)
  }
  for (const worktree of linkedWorktrees) requiredGitDir(gitDirs, worktree)
  return gitDirs
}

async function linkedWorktreeGitDir(
  gitDir: string,
  signal?: AbortSignal,
): Promise<{ worktreePath: string; gitDir: string } | null> {
  try {
    const pointer = (await readFile(path.join(gitDir, 'gitdir'), { encoding: 'utf8', signal })).trim()
    const resolvedPointer = path.isAbsolute(pointer) ? path.normalize(pointer) : path.resolve(gitDir, pointer)
    return path.basename(resolvedPointer) === '.git' ? { worktreePath: path.dirname(resolvedPointer), gitDir } : null
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

function requiredGitDir(gitDirs: ReadonlyMap<string, string>, worktree: Pick<WorktreeInfo, 'path'>): string {
  const gitDir = gitDirs.get(worktreePathKey(worktree.path))
  if (!gitDir) throw new Error('Git worktree administrative identity is unavailable')
  return gitDir
}

function worktreePathKey(worktreePath: string): string {
  return path.resolve(worktreePath)
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
    if (!value.startsWith('refs/heads/')) return null
    const branchName = value.slice('refs/heads/'.length)
    if (!isSafeBranchName(branchName)) throw new Error('Invalid rebase head-name')
    return branchName
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

async function readBisectBranchName(
  repoCwd: string,
  gitDir: string,
  bisectStartPath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const value = (await readFile(bisectStartPath, 'utf8')).trim()
    const branchName = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value
    if (!isSafeBranchName(branchName)) return null
    const refName = `refs/heads/${branchName}`
    const matchedRef = await git(repoCwd, ['--git-dir', gitDir, 'for-each-ref', '--format=%(refname)', '--', refName], {
      signal,
    })
    return matchedRef === refName ? branchName : null
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}
