// Composes the filesystem source with its runtime target boundary.

import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import {
  type WorkspaceFilesystemSourceOptions,
  readGitWorktreeFilesystemSourceLocal,
  readGitWorktreeFilesystemSourceRemote,
  readWorkspaceFilesystemSourceLocal,
  readWorkspaceFilesystemSourceRemote,
} from '#/server/workspaces/filesystem/source.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { resolveWorkspaceFilesystemExecution } from '#/server/workspaces/filesystem/execution.ts'

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

  const source =
    resolved.transport === 'remote'
      ? await (workspaceScoped ? readWorkspaceFilesystemSourceRemote : readGitWorktreeFilesystemSourceRemote)({
          target: resolved.remoteTarget,
          worktreePath: resolved.executionPath,
          options,
          signal: options.signal,
          run: resolved.run,
          ...(knownWorktrees ? { knownWorktrees } : {}),
        })
      : workspaceScoped
        ? await readWorkspaceFilesystemSourceLocal(resolved.executionPath, options, options.signal)
        : await readGitWorktreeFilesystemSourceLocal(resolved.executionPath, options, options.signal)
  return { nodes: source.nodes, truncated: source.truncated }
}
