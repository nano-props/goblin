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
import type { WorktreeStatus } from '#/shared/git-types.ts'
import { runWithRepoSource } from '#/server/modules/repo-source.ts'
import {
  type RepoTreeSourceOptions,
  getRepoTreeSourceLocal,
} from '#/server/modules/repo-tree-source.ts'

export interface GetRepositoryTreeOptions extends RepoTreeSourceOptions {
  readonly signal?: AbortSignal
  /** Skip the internal `getStatus` fetch and use this instead. Callers
   *  that already have a fresh status report (composite reads, etc.)
   *  pass it through; we never call `getRepoStatus` ourselves when
   *  this is provided. */
  readonly precomputedStatus?: ReadonlyArray<WorktreeStatus>
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

  const status =
    options.precomputedStatus ??
    (await runWithRepoSource(cwd, async (source) => await source.getStatus(signal)))
  if (signal?.aborted) return { nodes: [], truncated: false }

  const source = await getRepoTreeSourceLocal(worktreePath, options, signal, status)
  return { nodes: source.nodes, truncated: source.truncated }
}
