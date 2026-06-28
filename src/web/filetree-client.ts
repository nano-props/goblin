// Client boundary for the worktree-scoped file tree (docs/filetree.md).
//
// This module is the only path the UI uses to talk to the server
// about tree data. It mirrors the layering rule applied to other
// repo endpoints: the client boundary wraps `postServerJson`,
// forwards `cwd` and `worktreePath`, and never touches state,
// caching, retry logic, or hooks.
//
// Anti-coupling rules (enforced by review):
//   - Do not import any repo store, terminal hook, or settings
//     client from here.
//   - Do not subscribe to invalidation events from here.
//   - Do not throw on empty / soft-fail results: the wire returns
//     `{ nodes: [], truncated: false }` on failure and the caller
//     decides how to surface that.

import { postServerJson } from '#/web/lib/server-fetch.ts'
import type { RepoTreeResult } from '#/shared/api-types.ts'

export interface GetRepositoryTreeClientOptions {
  readonly prefix?: string
  readonly depth?: number
  readonly signal?: AbortSignal
}

export async function getRepositoryTree(
  cwd: string,
  worktreePath: string,
  options: GetRepositoryTreeClientOptions = {},
): Promise<RepoTreeResult> {
  return await postServerJson(
    '/api/repo/tree',
    {
      cwd,
      worktreePath,
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
      ...(options.depth !== undefined ? { depth: options.depth } : {}),
    },
    { signal: options.signal },
  )
}