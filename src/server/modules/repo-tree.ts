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
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { resolveRemoteRepoTarget } from '#/server/modules/repo-source.ts'
import {
  type RepoTreeSourceOptions,
  getRepoTreeSourceLocal,
  getRepoTreeSourceRemote,
} from '#/server/modules/repo-tree-source.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'

export interface RepositoryTreeReadOptions extends RepoTreeSourceOptions {
  /** Optional worktree list from callers that already have one. */
  readonly precomputedWorktrees?: ReadonlyArray<WorktreeInfo>
}

/** Read the file tree rooted at `worktreePath`. Soft-fails to
 *  `{ nodes: [], truncated: false }` on any error — the route layer
 *  mirrors that envelope, matching `getRepositorySnapshot`'s
 *  null-on-failure contract. */
export async function getRepositoryTree(
  cwd: string,
  worktreePath: string,
  options: RepositoryTreeReadOptions = {},
): Promise<RepoTreeResult> {
  // F2 (shape): reject obviously-malformed paths before any I/O. The
  // perimeter schema (`REPO_PROCEDURE_SCHEMAS.tree`) already
  // enforces this, but treating this as defense-in-depth means a
  // future caller that bypasses the schema (composite reads, IPC
  // bridges) still gets the same short-circuit.
  if (!hasUsableWorktreePath(worktreePath)) {
    return { nodes: [], truncated: false }
  }

  // Dispatch based on the cwd's repo kind. SSH remotes go through
  // `getRepoTreeSourceRemote`; local paths use the git-backed local
  // enumerator. Filetree is a display read, so it intentionally does
  // not depend on repo status, pull request state, or branch refresh.
  const isRemote = isRemoteRepoId(cwd)

  // When the cwd is remote, resolve the SSH target once before
  // handing the worktree path to the remote source.
  let remoteTarget: Awaited<ReturnType<typeof resolveRemoteRepoTarget>> | undefined
  if (isRemote) {
    try {
      remoteTarget = await resolveRemoteRepoTarget(cwd)
    } catch {
      // The user-facing error code is intentionally the same as a
      // soft-fail so the view does not flash an error banner on
      // every poll when the SSH alias has been removed mid-session.
      return { nodes: [], truncated: false }
    }
  }

  const worktrees =
    options.precomputedWorktrees ?? (isRemote ? undefined : await getWorktrees(cwd, { includeStatus: false }))

  // F2 (membership): validate that `worktreePath` is a known worktree
  // of this repo before we hand it to the source layer. The remote
  // source already validates via `resolveKnownRemoteWorktree` (and
  // returns the empty envelope when the path is unknown); this
  // read-layer guard closes the same gap on the local side, where an
  // unchecked path would let a hostile or buggy client ask git about
  // a directory outside this repo.
  //
  // Bare worktrees are excluded because they have no working tree to
  // walk. Remote validation lives in `getRemoteTreeWalk`; local
  // validation is performed here using `git worktree list`.
  if (!isRemote && !matchesKnownWorktree(worktrees, worktreePath)) {
    return { nodes: [], truncated: false }
  }

  try {
    const source = isRemote
      ? await getRepoTreeSourceRemote({
          target: remoteTarget as Awaited<ReturnType<typeof resolveRemoteRepoTarget>>,
          worktreePath,
          options,
          signal: undefined,
          ...(worktrees ? { knownWorktrees: worktrees } : {}),
        })
      : await getRepoTreeSourceLocal(worktreePath, options, undefined)
    return { nodes: source.nodes, truncated: source.truncated }
  } catch {
    return { nodes: [], truncated: false }
  }
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
function matchesKnownWorktree(
  worktrees: ReadonlyArray<WorktreeInfo> | undefined,
  worktreePath: string,
): boolean {
  const resolved = path.resolve(worktreePath)
  if (worktrees) {
    for (const wt of worktrees) {
      if (wt.isBare) continue
      if (path.resolve(wt.path) === resolved) return true
    }
  }
  return false
}
