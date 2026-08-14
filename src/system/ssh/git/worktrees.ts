import path from 'node:path'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { commandMayHaveRun, withoutMutationCommand } from '#/system/command-execution.ts'
import type { CommandExecution, CommandOutcome } from '#/system/command-execution.ts'
import {
  decodeRemoteGitWorktreeState,
  decodeRemoteStatus,
  decodeRemoteWorktrees,
  isValidRemotePath,
  parseRemoteRepoCommonDir,
} from '#/system/ssh/git/codec.ts'
import {
  gitOperationRequiresDetachedHead,
  hasUniqueRepoWorktreeMaterializedBranches,
  repoWorktreeForBranch,
  repoWorktreeMaterializedBranch,
} from '#/shared/git-types.ts'
import type { ExecResult, RepoWorktreeSnapshot, WorktreeInfo } from '#/shared/git-types.ts'
import { gitHead } from '#/shared/git-head.ts'
import { validateBranchDeletionPolicy, validateRemovableWorktreeState } from '#/shared/repo-action-policy.ts'
import { getRemoteGitDirectoryWalk } from '#/system/ssh/filesystem.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { normalizeCreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { WORKTREE_COMMAND_TIMEOUT_MS } from '#/shared/worktree-operation-timeouts.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { remoteCommandOutcome, remoteExecResult } from '#/system/ssh/command-execution.ts'
import { isRemoteCommandName, remoteCommandExistsAtPath } from '#/system/ssh/command-probe.ts'
import { REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS } from '#/system/ssh/git/timeouts.ts'
import { runRemoteWorktreeStatusProbe } from '#/system/ssh/git/status-admission.ts'
import {
  deleteRemoteUpstreamBranch,
  getRemoteBranchMergeFacts,
  getRemoteCurrentBranch,
  getRemoteUpstream,
} from '#/system/ssh/git/remote.ts'

const REMOTE_WORKTREE_SNAPSHOT_CONCURRENCY = 4

export interface RemoteFilesystemMutationResult extends ExecResult {
  worktreePathsToInvalidate?: readonly string[]
}

export interface RemoteWorktreeRemovalResult extends RemoteFilesystemMutationResult {
  worktreeRemoved?: true
  branchEffect?: 'local-delete-confirmed'
  failureExecution?: CommandExecution
  failureStage?: 'worktree-remove' | 'branch-delete'
}

interface RemoteBranchMutationStepResult extends ExecResult {
  branchEffect?: 'local-delete-confirmed'
  failureExecution?: CommandExecution
  failureStage?: 'branch-delete'
}

export async function readRemoteRepoWorktreeSnapshots(
  target: RemoteWorkspaceTarget,
  worktrees: readonly WorktreeInfo[],
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<RepoWorktreeSnapshot[]> {
  const usableWorktrees = worktrees.filter((worktree) => !worktree.isBare)
  if (usableWorktrees.length === 0) return []
  const commonDir = await resolveRemoteRepoCommonDir(target, { signal: options.signal, run: options.run })
  if (!commonDir) throw new Error('error.failed-read-repo')
  const snapshots = await mapWithConcurrency(
    usableWorktrees,
    REMOTE_WORKTREE_SNAPSHOT_CONCURRENCY,
    async (worktree) => {
      if (worktree.isPrunable || worktree.headOid === undefined) {
        throw new Error('error.failed-read-repo')
      }
      const result = await options.run(
        {
          type: 'gitOperationState',
          path: worktree.path,
          commonDir,
          isPrimary: worktree.isPrimary,
          attachedBranch: worktree.branch ?? null,
        },
        target,
        { signal: options.signal },
      )
      if (!result.ok || !result.stdout) throw new Error(result.message || 'error.failed-read-repo')
      const state = decodeRemoteGitWorktreeState(result.stdout)
      const head = gitHead(worktree.branch ?? null)
      if (head.kind === 'branch' && gitOperationRequiresDetachedHead(state.operation)) {
        throw new Error('error.failed-read-repo')
      }
      if (head.kind === 'branch' && state.materializedBranch !== head.branchName) {
        throw new Error('error.failed-read-repo')
      }
      if (head.kind === 'detached' && state.operation === null && state.materializedBranch !== null) {
        throw new Error('error.failed-read-repo')
      }
      if (worktree.headOid === null && (head.kind !== 'branch' || state.operation !== null)) {
        throw new Error('error.failed-read-repo')
      }
      return {
        path: worktree.path,
        head,
        headOid: worktree.headOid,
        operation: state.operation,
        materializedBranch: state.materializedBranch,
        isPrimary: worktree.isPrimary,
        isLocked: worktree.isLocked ?? false,
      }
    },
    { signal: options.signal, abort: 'throw' },
  )
  if (!hasUniqueRepoWorktreeMaterializedBranches(snapshots)) throw new Error('error.failed-read-repo')
  return snapshots
}

export async function getRemoteTreeWalk(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    prefix?: string
    run?: RemoteCommandRunner
    /** Optional trusted worktree list from the caller. When supplied,
     *  the resolver skips its own `gitWorktreeList` round trip and
     *  looks the requested path up in the list. The caller is
     *  responsible for the worktree list being fresh enough to
     *  validate against. */
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
  return await getRemoteGitDirectoryWalk(target, known.path, options)
}

export async function trashRemoteFile(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  filePath: string,
  options: {
    signal?: AbortSignal
    run?: RemoteCommandRunner
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
  const result = await run({ type: 'trashFile', path: known.path, filePath }, target, { signal: options.signal })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!result.ok) return remoteExecResult(result)
  return { ok: true, message: 'ok' }
}

export async function remoteCommandExists(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  commandName: string,
  options: {
    signal?: AbortSignal
    run?: RemoteCommandRunner
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<boolean> {
  if (!isRemoteCommandName(commandName)) return false
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  // This helper answers only "can this already-authorized worktree run
  // this command?". It returns false for invalid command names,
  // unresolved worktrees, and failed probes, so callers that need to
  // surface worktree/remote read failures must resolve the worktree
  // first with `resolveRemoteWorktree`.
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return false
  return await remoteCommandExistsAtPath(target, known.path, commandName, { signal: options.signal, run })
}

export async function resolveRemoteWorktree(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    run?: RemoteCommandRunner
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<WorktreeInfo> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) throw new Error(known.message)
  return known
}

export async function createRemoteWorktree(
  target: RemoteWorkspaceTarget,
  input: CreateWorktreeInput & {
    signal?: AbortSignal
    run?: RemoteCommandRunner
  },
): Promise<CommandOutcome<RemoteFilesystemMutationResult>> {
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  if (!isValidRemotePath(normalized.worktreePath)) {
    return withoutMutationCommand({ ok: false, message: 'error.invalid-path' })
  }
  const run: RemoteCommandRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitWorktreeAdd',
      path: target.remotePath,
      input: normalized,
    },
    target,
    { signal: input.signal, timeoutMs: WORKTREE_COMMAND_TIMEOUT_MS },
  )
  const { result: createResult, execution } = remoteCommandOutcome(result)
  const resultWithImpact = createResult.ok
    ? withWorktreePathsToInvalidate(createResult, [normalized.worktreePath])
    : createResult
  return {
    result: resultWithImpact,
    execution,
  }
}

export async function getRemoteRepoWorktreePaths(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<string[]> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  return worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)
}

export async function resolveRemoteWorktreePath(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<string | null> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'revParseTopLevel', path: worktreePath }, target, { signal: options.signal })
  if (options.signal?.aborted || !result.ok) return null
  const canonicalPath = result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout
  return canonicalPath.startsWith('/') && !/[\0\r\n]/u.test(canonicalPath) ? canonicalPath : null
}

export async function resolveRemoteRepoCommonDir(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<string | null> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'resolveRepoCommonDir', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted || !result.ok) return null
  return parseRemoteRepoCommonDir(result.stdout)
}

export async function removeRemoteWorktree(
  target: RemoteWorkspaceTarget,
  input: {
    branch: string
    worktreePath: string
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
    signal?: AbortSignal
    run?: RemoteCommandRunner
    beforeRemove: () => Promise<ExecResult>
    afterWorktreeRemoved: () => Promise<ExecResult>
  },
): Promise<RemoteWorktreeRemovalResult> {
  if (!isSafeBranchName(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (!isValidRemotePath(input.worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteCommandRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)
  const worktrees = decodeRemoteWorktrees(listResult.stdout)
  const worktreePathsToInvalidate = worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)

  const mainWorktreePath = worktrees.find((worktree) => worktree.isPrimary)?.path ?? worktrees[0]?.path ?? ''
  const resolved = resolveRemoteRemovableWorktree(worktrees, input.worktreePath, mainWorktreePath)
  if ('ok' in resolved) return resolved
  const worktreeSnapshots = await readRemoteRepoWorktreeSnapshots(target, worktrees, {
    signal: input.signal,
    run,
  })
  const resolvedPath = path.posix.resolve(resolved.path)
  const branchWorktree = repoWorktreeForBranch(worktreeSnapshots, input.branch)
  if (!branchWorktree || path.posix.resolve(branchWorktree.path) !== resolvedPath) {
    return { ok: false, message: 'error.worktree-not-found-for-branch' }
  }
  if (branchWorktree.operation !== null) {
    return { ok: false, message: 'error.cannot-remove-worktree-operation-in-progress' }
  }
  if (resolved.isLocked === true) return { ok: false, message: 'error.cannot-remove-locked-worktree' }
  const mutationPath = resolved.path === target.remotePath && mainWorktreePath ? mainWorktreePath : target.remotePath

  const status = await runRemoteWorktreeStatusProbe(target, resolved.path, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return remoteExecResult(status)
  const statusAwareWorktree = { ...resolved, isDirty: decodeRemoteStatus(status.stdout).length > 0 }
  const invalid = validateRemovableWorktreeState(statusAwareWorktree)
  if (invalid) return invalid

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  const upstream =
    input.deleteBranch && (!shouldForceDeleteBranch || input.deleteUpstream)
      ? await getRemoteUpstream(target, input.branch, {
          signal: input.signal,
          run,
          path: mutationPath,
        })
      : null
  if (input.deleteBranch) {
    const removedWorktreePath = path.posix.resolve(resolved.path)
    const currentBranch = await getRemoteCurrentBranch(target, {
      signal: input.signal,
      run,
      path: mutationPath,
    })
    const mergeFacts = shouldForceDeleteBranch
      ? { mergedToCurrent: false, mergedToUpstream: false }
      : await getRemoteBranchMergeFacts(target, input.branch, {
          signal: input.signal,
          run,
          currentBranch,
          path: mutationPath,
          upstream,
        })
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    const validation = validateBranchDeletionPolicy({
      branch: input.branch,
      currentBranch,
      isCheckedOutElsewhere: worktreeSnapshots.some(
        (worktree) =>
          path.posix.resolve(worktree.path) !== removedWorktreePath &&
          repoWorktreeMaterializedBranch(worktree) === input.branch,
      ),
      force: shouldForceDeleteBranch,
      mergedToCurrent: mergeFacts.mergedToCurrent,
      mergedToUpstream: mergeFacts.mergedToUpstream,
      notMergedMessage: 'error.cannot-remove-unpushed-worktree',
    })
    if (validation) return validation
  }

  const prepared = await input.beforeRemove()
  if (!prepared.ok) return prepared
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: mutationPath, worktreePath: resolved.path },
    target,
    {
      timeoutMs: WORKTREE_COMMAND_TIMEOUT_MS,
      signal: input.signal,
    },
  )
  const { result: removeCommandResult, execution: removeExecution } = remoteCommandOutcome(removeResult)
  if (!removeCommandResult.ok) {
    const failure: RemoteWorktreeRemovalResult = {
      ok: false,
      message: removeCommandResult.message,
      failureExecution: removeExecution,
      failureStage: 'worktree-remove',
    }
    return commandMayHaveRun(removeExecution)
      ? withWorktreePathsToInvalidate(failure, worktreePathsToInvalidate)
      : failure
  }
  const finalized = await input.afterWorktreeRemoved()
  if (!finalized.ok) {
    return withWorktreePathsToInvalidate(worktreeRemovedResult(finalized), worktreePathsToInvalidate)
  }
  if (!input.deleteBranch) {
    return withWorktreePathsToInvalidate(worktreeRemovedResult(removeCommandResult), worktreePathsToInvalidate)
  }

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: mutationPath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS, signal: input.signal },
  )
  const { result: localDeleteResult, execution: localDeleteExecution } = remoteCommandOutcome(deleteResult)
  if (!localDeleteResult.ok) {
    return withWorktreePathsToInvalidate(
      worktreeRemovedResult({
        ...localDeleteResult,
        failureExecution: localDeleteExecution,
        failureStage: 'branch-delete',
      }),
      worktreePathsToInvalidate,
    )
  }
  const upstreamDeleteOutcome = await deleteRemoteUpstreamBranch(
    target,
    mutationPath,
    input.deleteUpstream ? upstream : null,
    {
      signal: input.signal,
      run,
    },
  )
  const finalDeleteResult = finalRemoteBranchDeleteResult(localDeleteResult, upstreamDeleteOutcome)
  return withWorktreePathsToInvalidate(worktreeRemovedResult(finalDeleteResult), worktreePathsToInvalidate)
}

function finalRemoteBranchDeleteResult(
  localDeleteResult: RemoteBranchMutationStepResult,
  upstreamDeleteOutcome: CommandOutcome | null,
): RemoteBranchMutationStepResult {
  if (!upstreamDeleteOutcome) return localDeleteResult
  const { result: upstreamDeleteResult, execution: upstreamDeleteExecution } = upstreamDeleteOutcome
  if (upstreamDeleteResult.ok) return upstreamDeleteResult
  return {
    ...upstreamDeleteResult,
    branchEffect: 'local-delete-confirmed',
    failureExecution: upstreamDeleteExecution,
    failureStage: 'branch-delete',
  }
}

function worktreeRemovedResult(result: RemoteBranchMutationStepResult): RemoteWorktreeRemovalResult {
  if (result.ok) return { ok: true, message: result.message, worktreeRemoved: true }
  const removed: RemoteWorktreeRemovalResult = { ok: false, message: result.message, worktreeRemoved: true }
  if (result.branchEffect === 'local-delete-confirmed') removed.branchEffect = result.branchEffect
  if (result.failureExecution) removed.failureExecution = result.failureExecution
  if (result.failureStage) removed.failureStage = result.failureStage
  return removed
}

function withWorktreePathsToInvalidate(
  result: RemoteWorktreeRemovalResult,
  worktreePathsToInvalidate: readonly string[],
): RemoteWorktreeRemovalResult {
  const unique = Array.from(new Set(worktreePathsToInvalidate.filter((worktreePath) => worktreePath.length > 0)))
  return unique.length > 0 ? { ...result, worktreePathsToInvalidate: unique } : result
}

export async function readRemoteWorktreeMembership(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<WorktreeInfo[]> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return decodeRemoteWorktrees(result.stdout)
}

export async function resolveKnownRemoteWorktree(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    run: RemoteCommandRunner
    /** Pre-fetched worktree list; when supplied we skip the
     *  `gitWorktreeList` round trip. */
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  },
): Promise<WorktreeInfo | ExecResult> {
  let worktrees: ReadonlyArray<WorktreeInfo>
  if (options.knownWorktrees) {
    worktrees = options.knownWorktrees
  } else {
    const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
      signal: options.signal,
    })
    if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!result.ok) return remoteExecResult(result)
    worktrees = decodeRemoteWorktrees(result.stdout)
  }
  const resolvedPath = path.posix.resolve(worktreePath)
  const worktree = worktrees.find((item) => path.posix.resolve(item.path) === resolvedPath && !item.isBare)
  if (!worktree) return { ok: false, message: 'error.worktree-not-found' }
  return worktree
}

function resolveRemoteRemovableWorktree(
  worktrees: WorktreeInfo[],
  worktreePath: string,
  mainWorktreePath: string,
): WorktreeInfo | ExecResult {
  const resolvedPath = path.posix.resolve(worktreePath)
  const target = worktrees.find((worktree) => path.posix.resolve(worktree.path) === resolvedPath)
  if (!target) return { ok: false, message: 'error.worktree-not-found' }
  if (
    target.isPrimary ||
    (!!mainWorktreePath && path.posix.resolve(target.path) === path.posix.resolve(mainWorktreePath))
  ) {
    return { ok: false, message: 'error.cannot-remove-main-worktree' }
  }
  return target
}
