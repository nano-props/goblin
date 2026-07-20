import path from 'node:path'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { parseWorkspaceLocator, workspaceLocatorsShareTransport } from '#/shared/workspace-locator.ts'
import { remoteRuntimeAwareGitRunner, resolveRemoteWorkspaceTarget } from '#/server/modules/repo-source.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteWorktree, type RemoteGitRunner } from '#/system/ssh/git.ts'

interface ResolvedWorkspaceFilesystemExecutionBase {
  target: WorkspacePaneFilesystemExecutionTarget
  executionPath: string
  worktree: WorktreeInfo | null
}

export type ResolvedWorkspaceFilesystemExecution =
  | (ResolvedWorkspaceFilesystemExecutionBase & { transport: 'local' })
  | (ResolvedWorkspaceFilesystemExecutionBase & {
      transport: 'remote'
      remoteTarget: RemoteWorkspaceTarget
      run: RemoteGitRunner
    })

/** Resolve and authorize a runtime-bound filesystem target before native I/O. */
export async function resolveWorkspaceFilesystemExecution(
  target: WorkspacePaneFilesystemExecutionTarget,
  options: { signal?: AbortSignal } = {},
): Promise<ResolvedWorkspaceFilesystemExecution> {
  const { signal } = options
  const platform = process.platform === 'win32' ? 'win32' : 'posix'
  const workspace = parseWorkspaceLocator(target.workspaceId, platform)
  if (!workspace) throw new Error('error.workspace-locator-malformed')

  const rootId = target.kind === 'workspace-root' ? target.workspaceId : target.root
  if (!workspaceLocatorsShareTransport(target.workspaceId, rootId)) {
    throw new Error('error.workspace-target-transport-mismatch')
  }
  const root = parseWorkspaceLocator(rootId, platform)
  if (!root) throw new Error('error.workspace-locator-malformed')

  if (isRemoteWorkspaceId(target.workspaceId)) {
    const remoteTarget = await resolveRemoteWorkspaceTarget(
      target.workspaceId,
      { workspaceRuntimeId: target.workspaceRuntimeId },
      signal,
    )
    const run = remoteRuntimeAwareGitRunner(target.workspaceId, target.workspaceRuntimeId, remoteTarget)
    const worktree =
      target.kind === 'git-worktree'
        ? await resolveRemoteWorktree(remoteTarget, root.path, {
            signal,
            run,
          })
        : null
    return { transport: 'remote', target, executionPath: root.path, remoteTarget, run, worktree }
  }

  if (workspace.transport !== 'file' || root.transport !== 'file') {
    throw new Error('error.workspace-target-transport-mismatch')
  }
  const worktree =
    target.kind === 'git-worktree'
      ? requiredLocalWorktree(await getWorktrees(workspace.path, { includeStatus: false, signal }), root.path)
      : null
  return { transport: 'local', target, executionPath: root.path, worktree }
}

function requiredLocalWorktree(worktrees: readonly WorktreeInfo[], executionPath: string): WorktreeInfo {
  const resolved = path.resolve(executionPath)
  const worktree = worktrees.find((candidate) => !candidate.isBare && path.resolve(candidate.path) === resolved)
  if (!worktree) throw new Error('unknown worktree path')
  return worktree
}
