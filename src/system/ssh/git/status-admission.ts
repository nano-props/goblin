import PQueue from 'p-queue'
import { runWithQueuedAdmission } from '#/system/git/concurrency.ts'
import type { RemoteCommandKind, RemoteCommandResult } from '#/system/ssh/commands.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'

export const REMOTE_WORKTREE_STATUS_CONCURRENCY = 4

const remoteWorktreeStatusQueue = new PQueue({ concurrency: REMOTE_WORKTREE_STATUS_CONCURRENCY })

export async function runRemoteWorktreeStatusProbe(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<RemoteCommandResult> {
  return await runAdmittedRemoteStatusCommand(target, { type: 'gitStatus', path: worktreePath }, options)
}

export async function runRemoteWorktreeStatusAllProbe(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; timeoutMs: number; run: RemoteCommandRunner },
): Promise<RemoteCommandResult> {
  return await runAdmittedRemoteStatusCommand(target, { type: 'gitStatusAll', path: worktreePath }, options)
}

async function runAdmittedRemoteStatusCommand(
  target: RemoteWorkspaceTarget,
  command: Extract<RemoteCommandKind, { type: 'gitStatus' | 'gitStatusAll' }>,
  options: { signal?: AbortSignal; timeoutMs?: number; run: RemoteCommandRunner },
): Promise<RemoteCommandResult> {
  options.signal?.throwIfAborted()
  return await runWithQueuedAdmission(
    remoteWorktreeStatusQueue,
    options.signal,
    async () =>
      await options.run(command, target, {
        signal: options.signal,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
  )
}
