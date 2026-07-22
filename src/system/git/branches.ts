import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { omit } from 'es-toolkit'
import { git, gitResultWithOptions, NETWORK_TIMEOUT_MS } from '#/system/git/git-exec.ts'
import { FOR_EACH_REF_FIELD_SEP, PRETTY_FIELD_SEP, parseBranches, parseLog } from '#/system/git/parsers.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  type BranchSnapshotInfo,
  type ExecResult,
  type LogEntry,
  type WorktreeInfo,
} from '#/shared/git-types.ts'
import { gitHead, type GitHead } from '#/shared/git-head.ts'

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

export async function getRepoRoot(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  try {
    return await git(cwd, ['rev-parse', '--show-toplevel'], { signal: options?.signal })
  } catch {
    return ''
  }
}

export async function resolveRepoCommonDir(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  const commonDir = await git(cwd, ['rev-parse', '--git-common-dir'], { signal: options?.signal })
  if (!commonDir) throw new Error('Git returned an empty common directory')
  const absoluteCommonDir = path.isAbsolute(commonDir) ? path.normalize(commonDir) : path.resolve(cwd, commonDir)
  return path.normalize(await realpath(absoluteCommonDir))
}

export async function resolveRepoObjectsDir(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  const objectsDir = await git(cwd, ['rev-parse', '--git-path', 'objects'], { signal: options?.signal })
  if (!objectsDir) throw new Error('Git returned an empty objects directory')
  const absoluteObjectsDir = path.isAbsolute(objectsDir) ? path.normalize(objectsDir) : path.resolve(cwd, objectsDir)
  return path.normalize(await realpath(absoluteObjectsDir))
}

export async function getRepoName(cwd: string): Promise<string> {
  const root = await getRepoRoot(cwd)
  if (!root) return ''
  // git rev-parse always emits forward slashes, but a user-typed cwd may
  // contain backslashes on Windows — handle both.
  const idx = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  return idx >= 0 ? root.slice(idx + 1) : root
}

/** Authoritative HEAD read. `null` means a valid detached HEAD; failures throw. */
export async function getCurrentBranch(
  cwd: string,
  options?: { signal?: AbortSignal },
): Promise<string | null> {
  // Unlike `rev-parse --abbrev-ref HEAD`, `branch --show-current` also
  // reports the configured branch for a valid repository with an unborn
  // HEAD. Its only successful empty result is detached HEAD.
  const branch = await git(cwd, ['branch', '--show-current'], { signal: options?.signal })
  options?.signal?.throwIfAborted()
  return branch || null
}

/** Authoritative detached-HEAD identity read; failures and cancellation throw. */
export async function getHeadHash(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  const head = await git(cwd, ['rev-parse', '--short', 'HEAD'], { signal: options?.signal })
  options?.signal?.throwIfAborted()
  if (!head) throw new Error('Git returned an empty HEAD')
  return head
}

export async function getDefaultBranch(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  const ref = await git(cwd, ['for-each-ref', '--format=%(symref:short)', 'refs/remotes/origin/HEAD'], {
    signal: options?.signal,
  })
  return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
}

export function prioritizeDefaultBranch(branches: BranchSnapshotInfo[], defaultBranch: string): BranchSnapshotInfo[] {
  if (!defaultBranch) return branches
  const idx = branches.findIndex((branch) => branch.name === defaultBranch)
  if (idx <= 0) return branches
  return [branches[idx]!, ...branches.slice(0, idx), ...branches.slice(idx + 1)]
}

export function markDefaultBranch(branches: BranchSnapshotInfo[], defaultBranch: string): BranchSnapshotInfo[] {
  if (!defaultBranch && !branches.some((branch) => branch.isDefault)) return branches
  return branches.map((branch) => {
    if (branch.name === defaultBranch) return branch.isDefault ? branch : { ...branch, isDefault: true }
    if (!branch.isDefault) return branch
    return omit(branch, ['isDefault'])
  })
}

export function markMergedToDefault(
  branches: BranchSnapshotInfo[],
  defaultBranch: string,
  mergedBranches: Set<string>,
): BranchSnapshotInfo[] {
  if (!defaultBranch) return branches
  return branches.map((branch) => ({
    ...branch,
    mergedToDefault: branch.name === defaultBranch || mergedBranches.has(branch.name),
  }))
}

async function getMergedBranchNames(
  cwd: string,
  defaultBranch: string,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  if (!isSafeBranchName(defaultBranch)) return null
  const output = await git(cwd, ['branch', '--format=%(refname:short)', '--merged', defaultBranch], { signal })
  return new Set(
    output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )
}

/** Authoritative branch projection read. Optional display enrichments may degrade, but membership may not. */
export async function getBranches(
  cwd: string,
  worktrees: WorktreeInfo[] | undefined,
  currentBranch: string | null,
  options?: { signal?: AbortSignal },
): Promise<BranchSnapshotInfo[]> {
  const format = [
    '%(refname:short)',
    '%(objectname)',
    '%(objectname:short)',
    '%(subject)',
    '%(authordate:iso-strict)',
    '%(authorname)',
    '%(upstream:short)',
    '%(upstream:track)',
  ].join(FOR_EACH_REF_FIELD_SEP)
  const [output, defaultBranch] = await Promise.all([
    git(cwd, ['for-each-ref', `--format=${format}`, 'refs/heads/'], { signal: options?.signal }),
    getDefaultBranch(cwd, { signal: options?.signal }),
  ])
  options?.signal?.throwIfAborted()
  const mergedBranchNames = await getMergedBranchNames(cwd, defaultBranch, options?.signal)
  options?.signal?.throwIfAborted()
  const branches = markDefaultBranch(parseBranches(output, currentBranch ?? '', worktrees), defaultBranch)
  return prioritizeDefaultBranch(
    mergedBranchNames ? markMergedToDefault(branches, defaultBranch, mergedBranchNames) : branches,
    defaultBranch,
  )
}

export type BranchWorktreeIdentity =
  { kind: 'git-branch'; branchName: string } | { kind: 'git-worktree'; worktreePath: string; head: GitHead }

/** Strict, display-free branch membership read for admission/catalog paths. */
export async function getBranchWorktreeIdentities(
  cwd: string,
  worktrees: readonly WorktreeInfo[],
  options?: { signal?: AbortSignal },
): Promise<BranchWorktreeIdentity[]> {
  const output = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
    signal: options?.signal,
  })
  options?.signal?.throwIfAborted()
  const branches = output
    .split('\n')
    .map((branch) => branch.trim())
    .filter(Boolean)
  const usableWorktrees = worktrees.filter((worktree) => !worktree.isBare && !worktree.isPrunable)
  const checkedOutBranches = new Set(usableWorktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])))
  return [
    ...usableWorktrees.map((worktree): BranchWorktreeIdentity => ({
      kind: 'git-worktree',
      worktreePath: worktree.path,
      head: gitHead(worktree.branch ?? null),
    })),
    ...branches
      .filter((branch) => !checkedOutBranches.has(branch))
      .map((branch): BranchWorktreeIdentity => ({ kind: 'git-branch', branchName: branch })),
  ]
}

export async function getLog(
  cwd: string,
  branch: string,
  count = DEFAULT_REPOSITORY_LOG_COUNT,
  skip = 0,
  options?: { signal?: AbortSignal },
): Promise<LogEntry[]> {
  if (options?.signal?.aborted) return []
  if (!isSafeBranchName(branch)) return []
  try {
    const format = ['%H', '%h', '%D', '%s', '%an', '%aI'].join(PRETTY_FIELD_SEP)
    const args = [
      'log',
      '--decorate=short',
      `--format=${format}`,
      '-n',
      String(count),
      '--skip',
      String(skip),
      branch,
      '--',
    ]
    const output = await git(cwd, args, { signal: options?.signal })
    return parseLog(output)
  } catch (err) {
    if (options?.signal?.aborted) return []
    throw err
  }
}

export async function deleteBranch(
  cwd: string,
  name: string,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<ExecResult> {
  if (!isSafeBranchName(name)) return { ok: false, message: 'error.invalid-arguments' }
  return gitResultWithOptions(cwd, { signal: options?.signal }, 'branch', options?.force ? '-D' : '-d', '--', name)
}

export async function deleteUpstreamBranch(
  cwd: string,
  remote: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'push', '--delete', '--', remote, branch)
}

export interface BranchUpstream {
  ref: string
  remote: string
  branch: string
}

/** Resolve and validate `branch`'s upstream, or null when none is configured. */
export async function getUpstream(cwd: string, branch: string, signal?: AbortSignal): Promise<BranchUpstream | null> {
  if (!isSafeBranchName(branch)) return null
  signal?.throwIfAborted()
  const out = await git(cwd, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`], { signal })
  signal?.throwIfAborted()
  if (!out) return null
  const lines = out.split('\n')
  if (lines.length !== 1) throw new Error('Git returned an invalid upstream')
  const ref = lines[0]!
  const slash = ref.indexOf('/')
  if (slash <= 0) throw new Error('Git returned an invalid upstream')
  const remote = ref.slice(0, slash)
  const upstreamBranch = ref.slice(slash + 1)
  if (!isSafeBranchName(remote) || !isSafeBranchName(upstreamBranch)) {
    throw new Error('Git returned an invalid upstream')
  }
  return { ref, remote, branch: upstreamBranch }
}

/** Whether `ancestor` is reachable from `descendant` (i.e. every commit
 *  on `ancestor` is on `descendant`'s history). Mirrors the predicate
 *  `git branch -d` uses to decide if a branch is "fully merged".
 *  `descendant` may be 'HEAD', a branch name, or 'origin/foo'; we don't
 *  re-validate it because callers in this codebase pass either a fixed
 *  literal or a validated ref just produced by getUpstream. The
 *  trailing `--` keeps either argument from being interpreted as a flag
 *  if a future caller passes user input. */
export async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isSafeBranchName(ancestor)) return false
  signal?.throwIfAborted()
  try {
    await git(cwd, ['merge-base', '--is-ancestor', '--', ancestor, descendant], { signal })
    return true
  } catch (error) {
    if (hasExitCode(error, 1)) return false
    throw error
  }
}

function hasExitCode(error: unknown, exitCode: number): boolean {
  return typeof error === 'object' && error !== null && 'exitCode' in error && error.exitCode === exitCode
}
