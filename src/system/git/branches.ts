import { git, gitResultWithOptions, NETWORK_TIMEOUT_MS } from '#/system/git/helper.ts'
import { FIELD_SEP, parseBranches, parseLog } from '#/system/git/parsers.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import type { BranchSnapshotInfo, ExecResult, LogEntry, WorktreeInfo } from '#/shared/git-types.ts'

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

export async function getRepoName(cwd: string): Promise<string> {
  const root = await getRepoRoot(cwd)
  if (!root) return ''
  // git rev-parse always emits forward slashes, but a user-typed cwd may
  // contain backslashes on Windows — handle both.
  const idx = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  return idx >= 0 ? root.slice(idx + 1) : root
}

export async function getCurrentBranch(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  if (options?.signal?.aborted) return ''
  // `symbolic-ref` fails on detached HEAD — exactly what we want.
  // `rev-parse --abbrev-ref HEAD` would return literal "HEAD" there.
  try {
    return await git(cwd, ['symbolic-ref', '--short', 'HEAD'], { signal: options?.signal })
  } catch {
    return ''
  }
}

export async function getHeadHash(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  if (options?.signal?.aborted) return ''
  try {
    return await git(cwd, ['rev-parse', '--short', 'HEAD'], { signal: options?.signal })
  } catch {
    return ''
  }
}

export async function getDefaultBranch(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  try {
    const ref = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { signal: options?.signal })
    return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
  } catch {
    return ''
  }
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
    const { isDefault: _isDefault, ...rest } = branch
    return rest
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
  try {
    const output = await git(cwd, ['branch', '--format=%(refname:short)', '--merged', defaultBranch], { signal })
    return new Set(
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
  } catch {
    return null
  }
}

export async function getBranches(
  cwd: string,
  worktrees?: WorktreeInfo[],
  options?: { signal?: AbortSignal },
): Promise<BranchSnapshotInfo[]> {
  try {
    const format = [
      '%(refname:short)',
      '%(objectname:short)',
      '%(subject)',
      '%(authordate:iso-strict)',
      '%(authorname)',
      '%(upstream:short)',
      '%(upstream:track)',
    ].join(FIELD_SEP)

    const [output, currentBranch, defaultBranch] = await Promise.all([
      git(cwd, ['for-each-ref', `--format=${format}`, 'refs/heads/'], { signal: options?.signal }),
      getCurrentBranch(cwd, { signal: options?.signal }),
      getDefaultBranch(cwd, { signal: options?.signal }),
    ])
    if (options?.signal?.aborted) return []
    const mergedBranchNames = await getMergedBranchNames(cwd, defaultBranch, options?.signal)
    if (options?.signal?.aborted) return []
    const branches = markDefaultBranch(parseBranches(output, currentBranch, worktrees), defaultBranch)
    return prioritizeDefaultBranch(
      mergedBranchNames ? markMergedToDefault(branches, defaultBranch, mergedBranchNames) : branches,
      defaultBranch,
    )
  } catch {
    return []
  }
}

export async function getLog(
  cwd: string,
  branch: string,
  count = 100,
  skip = 0,
  options?: { signal?: AbortSignal },
): Promise<LogEntry[]> {
  if (!isSafeBranchName(branch)) return []
  try {
    const format = ['%H', '%h', '%s', '%an', '%aI'].join(FIELD_SEP)
    const args = ['log', `--format=${format}`, '-n', String(count), '--skip', String(skip), branch]
    const output = await git(cwd, args, { signal: options?.signal })
    return parseLog(output)
  } catch {
    return []
  }
}

export async function checkoutBranch(cwd: string, name: string, signal?: AbortSignal): Promise<ExecResult> {
  if (!isSafeBranchName(name)) return { ok: false, message: 'error.invalid-arguments' }
  return gitResultWithOptions(cwd, { signal }, 'switch', '--', name)
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

/** Resolve `branch`'s upstream short ref (e.g. "origin/feat") or null
 *  when the branch has no upstream configured. */
export async function getUpstream(cwd: string, branch: string, signal?: AbortSignal): Promise<string | null> {
  if (!isSafeBranchName(branch)) return null
  if (signal?.aborted) return null
  try {
    const out = await git(cwd, ['rev-parse', '--abbrev-ref', `${branch}@{u}`], { signal })
    return out.trim() || null
  } catch {
    return null
  }
}

/** Whether `ancestor` is reachable from `descendant` (i.e. every commit
 *  on `ancestor` is on `descendant`'s history). Mirrors the predicate
 *  `git branch -d` uses to decide if a branch is "fully merged".
 *  `descendant` may be 'HEAD', a branch name, or 'origin/foo'; we don't
 *  re-validate it because callers in this codebase pass either a fixed
 *  literal or a value just produced by git itself (getUpstream). The
 *  trailing `--` keeps either argument from being interpreted as a flag
 *  if a future caller passes user input. */
export async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isSafeBranchName(ancestor)) return false
  if (signal?.aborted) return false
  try {
    await git(cwd, ['merge-base', '--is-ancestor', '--', ancestor, descendant], { signal })
    return true
  } catch {
    return false
  }
}
