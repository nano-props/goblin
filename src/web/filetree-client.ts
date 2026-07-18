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
//   - Do not convert failures to empty trees or default viewers here:
//     callers own loading/error display, while server success means the
//     result is authoritative for the requested worktree.

import { postServerJson } from '#/web/lib/server-fetch.ts'
import type { RepoFileViewerResult, RepoTreeResult } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

export interface GetRepositoryTreeClientOptions {
  readonly prefix?: string
  readonly signal?: AbortSignal
}

export async function getRepositoryTree(
  target: WorkspacePaneFilesystemExecutionTarget,
  options: GetRepositoryTreeClientOptions,
): Promise<RepoTreeResult> {
  return await postServerJson(
    '/api/repo/tree',
    {
      target,
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
    },
    { signal: options.signal },
  )
}

export async function trashRepositoryFile(
  cwd: string,
  repoRuntimeId: string,
  worktreePath: string,
  path: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return await postServerJson('/api/repo/trash-file', { cwd, repoRuntimeId, worktreePath, path }, { signal: options.signal })
}

export async function getRepositoryFileViewer(
  cwd: string,
  worktreePath: string,
  options: { readonly repoRuntimeId: string; readonly signal?: AbortSignal },
): Promise<RepoFileViewerResult> {
  return await postServerJson(
    '/api/repo/file-viewer',
    { cwd, repoRuntimeId: options.repoRuntimeId, worktreePath },
    { signal: options.signal },
  )
}
