import { git, gitResult } from '#/main/git/helper.ts'
import { FIELD_SEP, parseBranches, parseLog } from '#/main/git/parsers.ts'
import { isSafeBranchName } from '#/main/git/refnames.ts'
import type { BranchInfo, ExecResult, LogEntry, WorktreeInfo } from '#/main/git/types.ts'

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

export async function getRepoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ['rev-parse', '--show-toplevel'])
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

export async function getCurrentBranch(cwd: string): Promise<string> {
  // `symbolic-ref` fails on detached HEAD — exactly what we want.
  // `rev-parse --abbrev-ref HEAD` would return literal "HEAD" there.
  try {
    return await git(cwd, ['symbolic-ref', '--short', 'HEAD'])
  } catch {
    return ''
  }
}

export async function getDefaultBranch(cwd: string): Promise<string> {
  try {
    const ref = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
  } catch {
    return ''
  }
}

export function prioritizeDefaultBranch(branches: BranchInfo[], defaultBranch: string): BranchInfo[] {
  if (!defaultBranch) return branches
  const idx = branches.findIndex((branch) => branch.name === defaultBranch)
  if (idx <= 0) return branches
  return [branches[idx]!, ...branches.slice(0, idx), ...branches.slice(idx + 1)]
}

export function markDefaultBranch(branches: BranchInfo[], defaultBranch: string): BranchInfo[] {
  if (!defaultBranch && !branches.some((branch) => branch.isDefault)) return branches
  return branches.map((branch) => {
    if (branch.name === defaultBranch) return branch.isDefault ? branch : { ...branch, isDefault: true }
    if (!branch.isDefault) return branch
    const { isDefault: _isDefault, ...rest } = branch
    return rest
  })
}

export async function getBranches(cwd: string, worktrees?: WorktreeInfo[]): Promise<BranchInfo[]> {
  try {
    const format = [
      '%(refname:short)',
      '%(objectname:short)',
      '%(subject)',
      '%(authordate:relative)',
      '%(authorname)',
      '%(upstream:short)',
      '%(upstream:track)',
    ].join(FIELD_SEP)

    const [output, currentBranch, defaultBranch] = await Promise.all([
      git(cwd, ['for-each-ref', `--format=${format}`, 'refs/heads/']),
      getCurrentBranch(cwd),
      getDefaultBranch(cwd),
    ])
    return prioritizeDefaultBranch(
      markDefaultBranch(parseBranches(output, currentBranch, worktrees), defaultBranch),
      defaultBranch,
    )
  } catch {
    return []
  }
}

export async function getLog(cwd: string, branch: string, count = 100): Promise<LogEntry[]> {
  try {
    const format = ['%H', '%h', '%s', '%an', '%ar'].join(FIELD_SEP)
    const output = await git(cwd, ['log', `--format=${format}`, '-n', String(count), branch])
    return parseLog(output)
  } catch {
    return []
  }
}

export async function checkoutBranch(cwd: string, name: string): Promise<ExecResult> {
  if (!isSafeBranchName(name)) return { ok: false, message: 'error.invalidArguments' }
  return gitResult(cwd, 'switch', '--', name)
}

export async function deleteBranch(cwd: string, name: string): Promise<ExecResult> {
  if (!isSafeBranchName(name)) return { ok: false, message: 'error.invalidArguments' }
  return gitResult(cwd, 'branch', '-d', '--', name)
}

/** Resolve `branch`'s upstream short ref (e.g. "origin/feat") or null
 *  when the branch has no upstream configured. */
export async function getUpstream(cwd: string, branch: string): Promise<string | null> {
  if (!isSafeBranchName(branch)) return null
  try {
    const out = await git(cwd, ['rev-parse', '--abbrev-ref', `${branch}@{u}`])
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
export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  if (!isSafeBranchName(ancestor)) return false
  try {
    await git(cwd, ['merge-base', '--is-ancestor', '--', ancestor, descendant])
    return true
  } catch {
    return false
  }
}
