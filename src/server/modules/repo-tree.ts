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
