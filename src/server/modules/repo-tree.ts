// Read layer for the worktree-scoped file tree (docs/filetree.md).
//
// This module composes the source layer (`repo-tree-source.ts`) with
// the minimal worktree boundary checks. It is the only place that
// touches the HTTP-facing `RepoTreeResult` wire shape, and the only
// entry point the route layer talks to.
//
// Anti-coupling rules (enforced by review):
//   - Do not call status/log/pull-request read modules from here.
//     Filetree is a display read; status overlays are intentionally
//     outside this v1 path.
//   - Do not call HTTP / route utilities here.
//   - Do not import UI types.

import path from 'node:path'
import type { RepoTreeResult } from '#/shared/api-types.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { remoteRuntimeAwareGitRunner, resolveRemoteWorkspaceTarget } from '#/server/modules/repo-source.ts'
import {
  type RepoTreeSourceOptions,
  getRepoTreeSourceLocal,
  getRepoTreeSourceRemote,
  getWorkspaceTreeSourceLocal,
  getWorkspaceTreeSourceRemote,
} from '#/server/modules/repo-tree-source.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { parseWorkspaceLocator, workspaceLocatorsShareTransport } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

export interface RepositoryTreeReadOptions extends RepoTreeSourceOptions {
  /** Optional worktree list from callers that already have one. */
  readonly precomputedWorktrees?: ReadonlyArray<WorktreeInfo>
  readonly workspaceRuntimeId?: string
  readonly signal?: AbortSignal
}

/** Read the file tree rooted at an explicit filesystem execution target. An empty result is
 *  authoritative only when the source successfully reads an empty
 *  directory; read, resolution, and membership failures throw so the
 *  client can surface an unavailable state instead of a fake empty tree. */
export async function getRepositoryTree(
  target: WorkspacePaneFilesystemExecutionTarget,
  options: RepositoryTreeReadOptions = {},
): Promise<RepoTreeResult> {
  const cwd = target.workspaceId
  const worktreePath = target.kind === 'workspace-root' ? target.workspaceId : target.root
  // Reject malformed locators before any I/O. The
  // perimeter schema already validates canonical workspace IDs; this keeps
  // direct server callers on the same boundary.
  if (!hasUsableWorktreePath(worktreePath)) {
    throw new Error('invalid worktree path')
  }
  if (!workspaceLocatorsShareTransport(cwd, worktreePath)) {
    throw new Error('error.workspace-target-transport-mismatch')
  }

  // Dispatch based on the cwd's repo kind. SSH remotes go through
  // `getRepoTreeSourceRemote`; local paths use the git-backed local
  // enumerator. Filetree is a display read, so it intentionally does
  // not depend on repo status, pull request state, or branch refresh.
  const isRemote = isRemoteWorkspaceId(cwd)
  const platform = process.platform === 'win32' ? 'win32' : 'posix'
  const locator = parseWorkspaceLocator(cwd, platform)
  if (!locator) throw new Error('error.workspace-locator-malformed')
  const workspaceScoped = target.kind === 'workspace-root'
  const worktreeLocator = workspaceScoped ? locator : parseWorkspaceLocator(target.root, platform)
  if (!worktreeLocator) {
    throw new Error('error.workspace-locator-malformed')
  }
  const resolvedWorktreePath = worktreeLocator.path

  // When the cwd is remote, resolve the SSH target once before
  // handing the worktree path to the remote source.
  let remoteTarget: Awaited<ReturnType<typeof resolveRemoteWorkspaceTarget>> | undefined
  if (isRemote) {
    remoteTarget = await resolveRemoteWorkspaceTarget(
      cwd,
      options.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined,
      options.signal,
    )
  }

  const worktrees = workspaceScoped
    ? undefined
    : options.precomputedWorktrees ??
      (isRemote
        ? undefined
        : await getWorktrees(locator.transport === 'file' ? locator.path : cwd, {
            includeStatus: false,
            signal: options.signal,
          }))

  // F2 (membership): validate that `worktreePath` is a known worktree
  // of this repo before we hand it to the source layer. The remote
  // source already validates via `resolveKnownRemoteWorktree`; this
  // read-layer guard closes the same gap on the local side, where an
  // unchecked path would let a hostile or buggy client ask git about
  // a directory outside this repo.
  //
  // Bare worktrees are excluded because they have no working tree to
  // walk. Remote validation lives in `getRemoteTreeWalk`; local
  // validation is performed here using `git worktree list`.
  if (!workspaceScoped && !isRemote && !matchesKnownWorktree(worktrees, resolvedWorktreePath)) {
    throw new Error('unknown worktree path')
  }

  let source
  if (isRemote) {
    const target = requiredRemoteTarget(remoteTarget)
    const readRemoteTree = workspaceScoped ? getWorkspaceTreeSourceRemote : getRepoTreeSourceRemote
    source = await readRemoteTree({
        target,
        worktreePath: resolvedWorktreePath,
        options,
        signal: options.signal,
        ...(options.workspaceRuntimeId
          ? { run: remoteRuntimeAwareGitRunner(cwd, options.workspaceRuntimeId, target) }
          : {}),
        ...(worktrees ? { knownWorktrees: worktrees } : {}),
      })
  } else {
    source = workspaceScoped
      ? await getWorkspaceTreeSourceLocal(resolvedWorktreePath, options, options.signal)
      : await getRepoTreeSourceLocal(resolvedWorktreePath, options, options.signal)
  }
  return { nodes: source.nodes, truncated: source.truncated }
}

function requiredRemoteTarget(
  target: Awaited<ReturnType<typeof resolveRemoteWorkspaceTarget>> | undefined,
): Awaited<ReturnType<typeof resolveRemoteWorkspaceTarget>> {
  if (!target) throw new Error('error.workspace-transport-unavailable')
  return target
}

/** Shape check for `worktreePath`. Empty strings and embedded NUL
 *  bytes are the only two malformations we care about: the former
 *  is meaningless as a directory argument, and the latter is the
 *  one character that is unsafe in a path on every supported OS.
 *  Anything more specific (length, leading slash, traversal) is
 *  enforced by the perimeter schema -- keeping this predicate
 *  tight means we do not duplicate schema policy here. */
function hasUsableWorktreePath(worktreePath: string): boolean {
  return worktreePath.length > 0 && !worktreePath.includes('\0')
}

/** Return true when `worktreePath` matches a known (non-bare) worktree.
 *  The comparison uses `path.resolve` so trailing slashes / `.` / `..`
 *  segments do not sneak past. Shape validation (empty / NUL) is
 *  performed up front in `getRepositoryTree` so this function only
 *  deals with membership. */
function matchesKnownWorktree(worktrees: ReadonlyArray<WorktreeInfo> | undefined, worktreePath: string): boolean {
  const resolved = path.resolve(worktreePath)
  if (worktrees) {
    for (const wt of worktrees) {
      if (wt.isBare) continue
      if (path.resolve(wt.path) === resolved) return true
    }
  }
  return false
}
