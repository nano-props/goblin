import path from 'node:path'
import { parseLog } from '#/system/git/parsers.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { commandMayHaveRun, withoutMutationCommand } from '#/system/command-execution.ts'
import type { CommandExecution, CommandOutcome } from '#/system/command-execution.ts'
import { isValidRemotePath } from '#/system/ssh/git/codec.ts'
import { repoLogTargetRevision, repoWorktreeForBranch } from '#/shared/git-types.ts'
import type { ExecResult, LogEntry, RepoLogTarget } from '#/shared/git-types.ts'
import { validateBranchDeletionPolicy } from '#/shared/repo-action-policy.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { remoteCommandOutcome } from '#/system/ssh/command-execution.ts'
import { REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS } from '#/system/ssh/git/timeouts.ts'
import { getRemoteSnapshot } from '#/system/ssh/git/snapshot.ts'
import {
  deleteRemoteUpstreamBranch,
  getRemoteBranchMergeFacts,
  getRemoteRemotes,
  getRemoteUpstream,
} from '#/system/ssh/git/remote.ts'
import type { RemoteFilesystemMutationResult } from '#/system/ssh/git/worktrees.ts'

type RemoteBranchEffect = 'none' | 'may-have-changed' | 'local-delete-confirmed'

export interface RemoteBranchDeleteResult extends ExecResult {
  branchEffect: RemoteBranchEffect
  failureExecution?: CommandExecution
}

export async function getRemoteLog(
  remoteTarget: RemoteWorkspaceTarget,
  target: RepoLogTarget,
  count?: number,
  skip?: number,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<LogEntry[]> {
  const revision = repoLogTargetRevision(target)
  if (!revision) return []
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitLog', path: remoteTarget.remotePath, revision, count, skip }, remoteTarget, {
    signal: options.signal,
  })
  if (options.signal?.aborted) return []
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return parseLog(result.stdout)
}

export async function pullRemoteBranch(
  target: RemoteWorkspaceTarget,
  branch: string,
  worktreePath?: string,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<CommandOutcome<RemoteFilesystemMutationResult>> {
  if (!isSafeBranchName(branch)) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  if (worktreePath && !isValidRemotePath(worktreePath)) {
    return withoutMutationCommand({ ok: false, message: 'error.invalid-path' })
  }
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  if (worktreePath) {
    if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
    const result = await run({ type: 'gitPullCurrent', path: worktreePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS,
    })
    return remoteOutcomeWithWorktreeInvalidation(remoteCommandOutcome(result), worktreePath)
  }

  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (snapshot.current === branch) {
    const result = await run({ type: 'gitPullCurrent', path: target.remotePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS,
    })
    return remoteOutcomeWithWorktreeInvalidation(remoteCommandOutcome(result), target.remotePath)
  }

  const upstream = await getRemoteUpstream(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (!upstream) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  const targetParts = upstream.source
  const remotes = await getRemoteRemotes(target, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (targetParts.remote !== '.' && !remotes.some((remote) => remote.name === targetParts.remote)) {
    return withoutMutationCommand({ ok: false, message: 'error.pull-no-remote' })
  }
  const result = await run(
    {
      type: 'gitFetchBranch',
      path: target.remotePath,
      remote: targetParts.remote,
      remoteBranch: targetParts.branch,
      branch,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS },
  )
  return remoteCommandOutcome(result)
}

function remoteOutcomeWithWorktreeInvalidation(
  outcome: CommandOutcome,
  worktreePath: string,
): CommandOutcome<RemoteFilesystemMutationResult> {
  const { result, execution } = outcome
  if (!commandMayHaveRun(execution)) return outcome
  return {
    result: {
      ok: result.ok,
      message: result.message,
      worktreePathsToInvalidate: [worktreePath],
    },
    execution,
  }
}

export async function deleteRemoteBranch(
  target: RemoteWorkspaceTarget,
  input: { branch: string; force?: boolean; deleteUpstream?: boolean; signal?: AbortSignal; run?: RemoteCommandRunner },
): Promise<RemoteBranchDeleteResult> {
  if (!isSafeBranchName(input.branch)) {
    return { ok: false, message: 'error.invalid-arguments', branchEffect: 'none' }
  }
  const run: RemoteCommandRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const snapshot = await getRemoteSnapshot(target, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled', branchEffect: 'none' }
  const shouldForce = input.force === true
  const upstream =
    !shouldForce || input.deleteUpstream
      ? await getRemoteUpstream(target, input.branch, { signal: input.signal, run })
      : null
  const mergeFacts = shouldForce
    ? { mergedToCurrent: false, mergedToUpstream: false }
    : await getRemoteBranchMergeFacts(target, input.branch, {
        signal: input.signal,
        run,
        currentBranch: snapshot.current,
        upstream,
      })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled', branchEffect: 'none' }
  const validation = validateBranchDeletionPolicy({
    branch: input.branch,
    currentBranch: snapshot?.current,
    isCheckedOutElsewhere: !!snapshot && !!repoWorktreeForBranch(snapshot.worktrees, input.branch),
    force: shouldForce,
    mergedToCurrent: mergeFacts.mergedToCurrent,
    mergedToUpstream: mergeFacts.mergedToUpstream,
  })
  if (validation) return { ok: validation.ok, message: validation.message, branchEffect: 'none' }
  if (input.signal?.aborted) return { ok: false, message: 'cancelled', branchEffect: 'none' }
  const result = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForce },
    target,
    { signal: input.signal, timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS },
  )
  const { result: localDeleteResult, execution: localDeleteExecution } = remoteCommandOutcome(result)
  if (!localDeleteResult.ok) {
    if (!commandMayHaveRun(localDeleteExecution)) {
      return {
        ok: false,
        message: localDeleteResult.message,
        branchEffect: 'none',
        failureExecution: localDeleteExecution,
      }
    }
    return {
      ok: false,
      message: localDeleteResult.message,
      branchEffect: 'may-have-changed',
      failureExecution: localDeleteExecution,
    }
  }
  const upstreamDeleteOutcome = await deleteRemoteUpstreamBranch(
    target,
    target.remotePath,
    input.deleteUpstream ? upstream : null,
    { signal: input.signal, run },
  )
  if (!upstreamDeleteOutcome)
    return { ok: true, message: localDeleteResult.message, branchEffect: 'local-delete-confirmed' }
  const { result: upstreamDeleteResult, execution: upstreamDeleteExecution } = upstreamDeleteOutcome
  if (upstreamDeleteResult.ok) {
    return { ok: true, message: upstreamDeleteResult.message, branchEffect: 'local-delete-confirmed' }
  }
  return {
    ok: false,
    message: upstreamDeleteResult.message,
    branchEffect: 'local-delete-confirmed',
    failureExecution: upstreamDeleteExecution,
  }
}
