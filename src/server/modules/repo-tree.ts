// Read layer for the worktree-scoped file tree (docs/filetree.md).
//
// This module composes the source layer (`repo-tree-source.ts`) with
// the worktree status overlay. It is the only place that calls
// `runWithRepoSource`, the only place that touches the HTTP-facing
// `RepoTreeResult` wire shape, and the only entry point the route
// layer talks to.
//
// Anti-coupling rules (enforced by review):
//   - Do not call other read modules from here. If a caller already
//     has a fresh `WorktreeStatus[]`, pass it via
//     `options.precomputedStatus` and we will skip our own fetch.
//   - Do not call HTTP / route utilities here.
//   - Do not import UI types.

import path from 'node:path'
import type { RepoTreeResult } from '#/shared/api-types.ts'
import type { WorktreeInfo, WorktreeStatus } from '#/shared/git-types.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { runWithRepoSource, resolveRemoteRepoTarget } from '#/server/modules/repo-source.ts'
import {
  type RepoTreeSourceOptions,
  getRepoTreeSourceLocal,
  getRepoTreeSourceRemote,
} from '#/server/modules/repo-tree-source.ts'

export interface GetRepositoryTreeOptions extends RepoTreeSourceOptions {
  readonly signal?: AbortSignal
  /** Skip the internal `getStatus` fetch and use this instead. Callers
   *  that already have a fresh status report (composite reads, etc.)
   *  pass it through; we never call `getRepoStatus` ourselves when
   *  this is provided. */
  readonly precomputedStatus?: ReadonlyArray<WorktreeStatus>
  /** Same skip pattern as `precomputedStatus` but for the worktree
   *  list. When the caller already has a `WorktreeInfo[]` (e.g. a
   *  composite read), the remote tree walk can skip its own
   *  `gitWorktreeList` round trip and look the requested path up
   *  in this list instead. Local path ignores the field — the
   *  walker already validates against the filesystem directly. */
  readonly precomputedWorktrees?: ReadonlyArray<WorktreeInfo>
}

/** Read the file tree rooted at `worktreePath`, with a git-status
 *  overlay applied. Soft-fails to `{ nodes: [], truncated: false }`
 *  on any error — the route layer mirrors that envelope, matching
 *  `getRepositorySnapshot`'s null-on-failure contract. */
export async function getRepositoryTree(
  cwd: string,
  worktreePath: string,
  options: GetRepositoryTreeOptions = {},
): Promise<RepoTreeResult> {
  const signal = options.signal
  if (signal?.aborted) return { nodes: [], truncated: false }

  // F2 (shape): reject obviously-malformed paths before any I/O. The
  // perimeter schema (`REPO_PROCEDURE_SCHEMAS.tree`) already
  // enforces this, but treating this as defense-in-depth means a
  // future caller that bypasses the schema (composite reads, IPC
  // bridges) still gets the same short-circuit.
  if (!hasUsableWorktreePath(worktreePath)) {
    return { nodes: [], truncated: false }
  }

  // Dispatch based on the cwd's repo kind. SSH remotes go through
  // `getRepoTreeSourceRemote` (PR 5); local paths use the
  // tinyglobby-based local walker. The status fetch is always
  // routed through `runWithRepoSource` so the caller does not need
  // to know the repo kind to read status — only to enumerate
  // files.
  const isRemote = isRemoteRepoId(cwd)

  // When the cwd is remote, resolve the SSH target exactly once
  // and reuse it for both the status fetch and the tree walk so we
  // don't pay the SSH config lookup twice per request.
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
    if (signal?.aborted) return { nodes: [], truncated: false }
  }

  let status: ReadonlyArray<WorktreeStatus>
  let worktrees: ReadonlyArray<WorktreeInfo> | undefined
  if (options.precomputedStatus) {
    status = options.precomputedStatus
    worktrees = options.precomputedWorktrees
  } else {
    // Combined fetch: statuses + worktree list in one call.
    // Remote: 1 SSH (the `gitWorktreeListAndStatus` batch).
    // Local: parallel `getWorkingStatus` + `getWorktrees`.
    const combined = await runWithRepoSource(cwd, async (source) =>
      source.getStatusAndWorktrees(signal),
    )
    if (signal?.aborted) return { nodes: [], truncated: false }
    status = combined.statuses
    worktrees = combined.worktrees
  }

  // F2 (membership): validate that `worktreePath` is a known worktree
  // of this repo before we hand it to the source layer. The remote
  // source already validates via `resolveKnownRemoteWorktree` (and
  // returns the empty envelope when the path is unknown); this
  // read-layer guard closes the same gap on the local side, where
  // tinyglobby would happily walk any directory the caller names --
  // including paths outside the repo, which a hostile or buggy
  // client could exploit.
  //
  // Validation runs against whichever worktree data we have on hand
  // (freshly-fetched list, or the precomputed inputs). Bare worktrees
  // are excluded because they have no working tree to walk. If we
  // have no data at all (caller passed an empty `precomputedStatus`
  // without `precomputedWorktrees`) we fall through and let the
  // source layer's own error path produce the empty envelope.
  if (!matchesKnownWorktree(worktrees, status, worktreePath)) {
    return { nodes: [], truncated: false }
  }

  const source = isRemote
    ? await getRepoTreeSourceRemote({
        target: remoteTarget as Awaited<ReturnType<typeof resolveRemoteRepoTarget>>,
        worktreePath,
        options,
        signal,
        precomputedStatus: status,
        ...(worktrees ? { knownWorktrees: worktrees } : {}),
      })
    : await getRepoTreeSourceLocal(worktreePath, options, signal, status)
  return { nodes: source.nodes, truncated: source.truncated }
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

/** Return true when `worktreePath` matches a known (non-bare) worktree
 *  in either the freshly-fetched list or the status report. Both
 *  sources carry the worktree's path; matching against both keeps the
 *  precomputedStatus-only code path honest. The comparison uses
 *  `path.resolve` so trailing slashes / `.` / `..` segments do not
 *  sneak past. Shape validation (empty / NUL) is performed up
 *  front in `getRepositoryTree` so this function only deals with
 *  membership. */
function matchesKnownWorktree(
  worktrees: ReadonlyArray<WorktreeInfo> | undefined,
  statuses: ReadonlyArray<WorktreeStatus>,
  worktreePath: string,
): boolean {
  const resolved = path.resolve(worktreePath)
  if (worktrees) {
    for (const wt of worktrees) {
      if (wt.isBare) continue
      if (path.resolve(wt.path) === resolved) return true
    }
  }
  for (const status of statuses) {
    if (path.resolve(status.path) === resolved) return true
  }
  return false
}
