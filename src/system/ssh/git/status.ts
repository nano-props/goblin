import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { decodeRemoteStatus } from '#/system/ssh/git/codec.ts'
import type { WorktreeInfo, WorktreeStatus } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { readRemoteWorktreeMembership } from '#/system/ssh/git/worktrees.ts'
import { REMOTE_WORKTREE_STATUS_CONCURRENCY, runRemoteWorktreeStatusProbe } from '#/system/ssh/git/status-admission.ts'

export async function getRemoteStatus(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<WorktreeStatus[]> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  return await sampleRemoteWorktreeStatus(target, worktrees, { signal: options.signal, run })
}

async function sampleRemoteWorktreeStatus(
  target: RemoteWorkspaceTarget,
  worktrees: readonly WorktreeInfo[],
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<WorktreeStatus[]> {
  const sampled = await mapWithConcurrency(
    [...worktrees],
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => await sampleRemoteWorktreeStatusForTarget(target, worktree, options),
    { signal: options.signal, abort: 'throw' },
  )
  return sampled.filter((status): status is WorktreeStatus => status !== null)
}

async function sampleRemoteWorktreeStatusForTarget(
  target: RemoteWorkspaceTarget,
  worktree: WorktreeInfo,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<WorktreeStatus | null> {
  options.signal?.throwIfAborted()
  if (worktree.isBare) return null
  const result = await runRemoteWorktreeStatusProbe(target, worktree.path, options)
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return {
    path: worktree.path,
    branch: worktree.branch,
    isMain: worktree.isPrimary,
    entries: decodeRemoteStatus(result.stdout),
  }
}
