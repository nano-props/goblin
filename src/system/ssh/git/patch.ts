import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { decodeRemoteStatus } from '#/system/ssh/git/codec.ts'
import { remoteExecResult } from '#/system/ssh/command-execution.ts'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { resolveKnownRemoteWorktree } from '#/system/ssh/git/worktrees.ts'
import { runRemoteWorktreeStatusAllProbe } from '#/system/ssh/git/status-admission.ts'

const REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY = 8

const REMOTE_PATCH_TIMEOUT_MS = 90_000

class RemotePatchFileReadError extends Error {
  readonly result: ExecResult

  constructor(result: ExecResult) {
    super(result.message)
    this.result = result
  }
}

export async function getRemotePatch(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    run?: RemoteCommandRunner
    /** See `getRemoteTreeWalk`. */
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<ExecResult> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return known
  const tracked = await run({ type: 'gitPatch', path: known.path }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!tracked.ok) return remoteExecResult(tracked)

  const status = await runRemoteWorktreeStatusAllProbe(target, known.path, {
    run,
    signal: options.signal,
    timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return remoteExecResult(status)

  const untrackedPaths = decodeRemoteStatus(status.stdout)
    .filter((entry) => entry.x === '?' && entry.y === '?')
    .map((entry) => entry.path)
  let patchTexts: string[]
  try {
    patchTexts = await mapWithConcurrency(
      untrackedPaths,
      REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY,
      async (filePath): Promise<string> => {
        const result = await run({ type: 'gitDiffNoIndex', path: known.path, filePath }, target, {
          signal: options.signal,
          timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
        })
        options.signal?.throwIfAborted()
        if (!result.ok) throw new RemotePatchFileReadError(remoteExecResult(result))
        return result.stdout
      },
      { signal: options.signal, abort: 'throw' },
    )
  } catch (err) {
    if (err instanceof RemotePatchFileReadError) return err.result
    throw err
  }
  const combined = [tracked.stdout, ...patchTexts].filter((part) => part.length > 0).join('\n')
  return { ok: true, message: combined.length > 0 ? `${combined}\n` : '' }
}
