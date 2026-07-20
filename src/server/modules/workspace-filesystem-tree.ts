// Read layer for the worktree-scoped file tree (docs/filetree.md).
//
// This module composes the workspace filesystem source with
// the minimal worktree boundary checks. It is the only place that
// touches the HTTP-facing `WorkspaceFilesystemTreeResult` wire shape, and the only
// entry point the route layer talks to.
//
// Anti-coupling rules (enforced by review):
//   - Do not call status/log/pull-request read modules from here.
//     Filetree is a display read; status overlays are intentionally
//     outside this v1 path.
//   - Do not call HTTP / route utilities here.
//   - Do not import UI types.

import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import {
  type WorkspaceFilesystemSourceOptions,
  readGitWorktreeFilesystemSourceLocal,
  readGitWorktreeFilesystemSourceRemote,
  readWorkspaceFilesystemSourceLocal,
  readWorkspaceFilesystemSourceRemote,
} from '#/server/modules/workspace-filesystem-source.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { resolveWorkspaceFilesystemExecution } from '#/server/modules/workspace-filesystem-execution.ts'

export interface WorkspaceFilesystemTreeReadOptions extends WorkspaceFilesystemSourceOptions {
  readonly signal?: AbortSignal
}

/** Read the file tree rooted at an explicit filesystem execution target. An empty result is
 *  authoritative only when the source successfully reads an empty
 *  directory; read, resolution, and membership failures throw so the
 *  client can surface an unavailable state instead of a fake empty tree. */
export async function readWorkspaceFilesystemTree(
  target: WorkspacePaneFilesystemExecutionTarget,
  options: WorkspaceFilesystemTreeReadOptions = {},
): Promise<WorkspaceFilesystemTreeResult> {
  const workspaceScoped = target.kind === 'workspace-root'
  const resolved = await resolveWorkspaceFilesystemExecution(target, { signal: options.signal })
  const knownWorktrees = resolved.worktree ? [resolved.worktree] : undefined

  let source
  if (resolved.transport === 'remote') {
    const readRemoteTree = workspaceScoped ? readWorkspaceFilesystemSourceRemote : readGitWorktreeFilesystemSourceRemote
    source = await readRemoteTree({
      target: resolved.remoteTarget,
      worktreePath: resolved.executionPath,
      options,
      signal: options.signal,
      run: resolved.run,
      ...(knownWorktrees ? { knownWorktrees } : {}),
    })
  } else {
    source = workspaceScoped
      ? await readWorkspaceFilesystemSourceLocal(resolved.executionPath, options, options.signal)
      : await readGitWorktreeFilesystemSourceLocal(resolved.executionPath, options, options.signal)
  }
  return { nodes: source.nodes, truncated: source.truncated }
}
