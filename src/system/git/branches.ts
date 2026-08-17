import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { omit } from 'es-toolkit'
import { git, gitCommandResultWithOptions, NETWORK_TIMEOUT_MS } from '#/system/git/git-exec.ts'
import { withoutMutationCommand, type CommandOutcome } from '#/system/command-execution.ts'
import {
  FOR_EACH_REF_FIELD_SEP,
  PRETTY_FIELD_SEP,
  normalizeGitPath,
  parseBranches,
  parseLog,
} from '#/system/git/parsers.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  repoLogTargetRevision,
  type BranchSnapshotInfo,
  type ExecResult,
  type LogEntry,
  type RepoLogTarget,
  type RepoWorktreeTargetProjection,
  type WorkspacePaneTargetIdentity,
  type WorktreeInfo,
} from '#/shared/git-types.ts'
import { repoWorktreeMaterializedBranch } from '#/shared/git-types.ts'
import { decodeGitUpstream, GIT_UPSTREAM_FORMAT, type GitUpstream } from '#/system/git/upstream.ts'

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
    const root = await git(cwd, ['rev-parse', '--show-toplevel'], { signal: options?.signal })
    return normalizeGitPath(root, process.platform === 'win32' ? 'win32' : 'posix')
  } catch {
    return ''
  }
}

/** Physical root of the addressed Git workspace. Bare repositories use their
 * common directory because they have no working-tree top level. */
export async function resolveGitWorkspacePath(cwd: string, options?: { signal?: AbortSignal }): Promise<string> {
  const bare = await git(cwd, ['rev-parse', '--is-bare-repository'], { signal: options?.signal })
  if (bare === 'true') return await resolveRepoCommonDir(cwd, options)
  if (bare !== 'false') throw new Error('Git returned an invalid bare-repository state')
  const root = await git(cwd, ['rev-parse', '--show-toplevel'], { signal: options?.signal })
  if (!root) throw new Error('Git returned an empty workspace root')
  const normalizedRoot = normalizeGitPath(root, process.platform === 'win32' ? 'win32' : 'posix')
  return path.normalize(await realpath(normalizedRoot))
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
export async function getCurrentBranch(cwd: string, options?: { signal?: AbortSignal }): Promise<string | null> {
  // Unlike `rev-parse --abbrev-ref HEAD`, `branch --show-current` also
  // reports the configured branch for a valid repository with an unborn
  // HEAD. Its only successful empty result is detached HEAD.
  const branch = await git(cwd, ['branch', '--show-current'], { signal: options?.signal })
  options?.signal?.throwIfAborted()
  return branch || null
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
export async function getBranches(cwd: string, options?: { signal?: AbortSignal }): Promise<BranchSnapshotInfo[]> {
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
  const branches = markDefaultBranch(parseBranches(output), defaultBranch)
  return prioritizeDefaultBranch(
    mergedBranchNames ? markMergedToDefault(branches, defaultBranch, mergedBranchNames) : branches,
    defaultBranch,
  )
}

/** Strict, display-free branch membership read for admission/catalog paths. */
export async function getBranchWorktreeIdentities(
  cwd: string,
  worktrees: readonly RepoWorktreeTargetProjection[],
  options?: { signal?: AbortSignal },
): Promise<WorkspacePaneTargetIdentity[]> {
  const output = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
    signal: options?.signal,
  })
  options?.signal?.throwIfAborted()
  const branches = output ? output.split('\n') : []
  const branchNames = new Set(branches)
  if (branches.some((branch) => !isSafeBranchName(branch)) || branchNames.size !== branches.length) {
    throw new Error('Git returned invalid branch identities')
  }
  if (
    worktrees.some(
      (worktree) =>
        worktree.headOid !== null &&
        worktree.materializedBranch !== null &&
        !branchNames.has(worktree.materializedBranch),
    )
  ) {
    throw new Error('Git worktree materialized branch is unavailable')
  }
  const materializedBranches = new Set(
    worktrees.flatMap((worktree) => {
      const branchName = repoWorktreeMaterializedBranch(worktree)
      return branchName ? [branchName] : []
    }),
  )
  return [
    ...worktrees.map((worktree): WorkspacePaneTargetIdentity => ({
      kind: 'git-worktree',
      worktreePath: worktree.path,
      head: worktree.head,
      materializedBranch: worktree.materializedBranch,
    })),
    ...branches
      .filter((branch) => !materializedBranches.has(branch))
      .map((branch): WorkspacePaneTargetIdentity => ({ kind: 'git-branch', branchName: branch })),
  ]
}

export async function getLog(
  cwd: string,
  target: RepoLogTarget,
  count = DEFAULT_REPOSITORY_LOG_COUNT,
  skip = 0,
  options?: { signal?: AbortSignal },
): Promise<LogEntry[]> {
  if (options?.signal?.aborted) return []
  const revision = repoLogTargetRevision(target)
  if (!revision) return []
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
      revision,
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
): Promise<CommandOutcome> {
  if (!isSafeBranchName(name)) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  return gitCommandResultWithOptions(
    cwd,
    { signal: options?.signal },
    'branch',
    options?.force ? '-D' : '-d',
    '--',
    name,
  )
}

export async function deleteUpstreamBranch(
  cwd: string,
  remote: string,
  branch: string,
  signal?: AbortSignal,
): Promise<CommandOutcome> {
  if (!isSafeBranchName(branch)) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  return gitCommandResultWithOptions(
    cwd,
    { timeoutMs: NETWORK_TIMEOUT_MS, signal },
    'push',
    '--delete',
    '--',
    remote,
    branch,
  )
}

/** Resolve and validate `branch`'s upstream, or null when none is configured. */
export async function getUpstream(cwd: string, branch: string, signal?: AbortSignal): Promise<GitUpstream | null> {
  if (!isSafeBranchName(branch)) return null
  signal?.throwIfAborted()
  const out = await git(cwd, ['for-each-ref', `--format=${GIT_UPSTREAM_FORMAT}`, `refs/heads/${branch}`], { signal })
  signal?.throwIfAborted()
  return decodeGitUpstream(out)
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
