// Client boundary for workspace-root and Git-worktree filesystem operations.
//
// This module is the only path the UI uses to talk to the server about
// filesystem tree, viewer, and trash operations. It forwards one explicit
// execution target and never touches state, caching, retry logic, or hooks.
//
// Anti-coupling rules (enforced by review):
//   - Do not import a workspace store, terminal hook, or settings client.
//   - Do not subscribe to invalidation events from here.
//   - Do not convert failures to empty trees or default viewers here:
//     callers own loading/error display, while server success means the
//     result is authoritative for the requested worktree.

import { postServerJson } from '#/web/lib/server-fetch.ts'
import type { WorkspaceFileViewerResult, WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { ExecResultResponseSchema } from '#/shared/http-response-schema.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import {
  WorkspaceFilesystemTreeResponseSchema,
  WorkspaceFileViewerResponseSchema,
} from '#/shared/workspace-http-response-schema.ts'

export interface GetWorkspaceFilesystemTreeOptions {
  readonly prefix?: string
  readonly signal?: AbortSignal
}

export async function getWorkspaceFilesystemTree(
  target: WorkspacePaneFilesystemExecutionTarget,
  options: GetWorkspaceFilesystemTreeOptions,
): Promise<WorkspaceFilesystemTreeResult> {
  return await postServerJson(
    '/api/workspace/tree',
    {
      target,
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
    },
    decodeWith(WorkspaceFilesystemTreeResponseSchema),
    { signal: options.signal },
  )
}

export async function trashWorkspaceFile(
  target: WorkspacePaneFilesystemExecutionTarget,
  path: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return await postServerJson('/api/workspace/trash-file', { target, path }, decodeWith(ExecResultResponseSchema), { signal: options.signal })
}

export async function getWorkspaceFileViewer(
  target: WorkspacePaneFilesystemExecutionTarget,
  options: { readonly signal?: AbortSignal },
): Promise<WorkspaceFileViewerResult> {
  return await postServerJson('/api/workspace/file-viewer', { target }, decodeWith(WorkspaceFileViewerResponseSchema), { signal: options.signal })
}
