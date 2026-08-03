import path from 'node:path'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { serverLogger } from '#/server/logger.ts'
import { publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  captureRepoWriteExecutionFromPhysicalWorktree,
  runWithRepoSource,
  type RepoSource,
  type RepoWriteExecutionCapability,
} from '#/server/modules/repo-source.ts'
import {
  RepoMutationRuntimeFailureError,
  isRepoMutationRuntimeFailureError,
} from '#/server/modules/repo-mutation-runtime-failure.ts'
import { appendRepoMutationRecoveryMessageKey, type RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { RemoteTrackingBranchIdentity } from '#/shared/worktree-create.ts'
import {
  enqueueRepoWriteOperation,
  type RepoWriteOperationContext,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import {
  pruneServerWorkspaceSettingsForRemovedWorktree,
  setServerWorkspaceWorktreeBootstrapConfigTrust,
} from '#/server/modules/settings-source.ts'
import { type ExecResult, type ExecResultRecoveryMessageKey, type RepoUrlTarget } from '#/shared/git-types.ts'
import type { NetworkOpKind, RepoServerOperationKind, RepoServerOperationTarget } from '#/shared/api-types.ts'
import { isValidWorkspaceLocatorInput, toSafeWorkspaceLocator } from '#/shared/input-validation.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { normalizeCreateWorktreeInput, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'

const repoWriteLogger = serverLogger.child({ module: 'repo-write-paths' })

async function runUserNetworkMutation(
  cwd: WorkspaceId,
  signal: AbortSignal | undefined,
  operationKind: 'pull' | 'push',
  target: { branch?: string; worktreePath?: string } | null,
  task: (source: RepoSource, signal: AbortSignal | undefined) => Promise<RepoMutationResult>,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoMutationResult> {
  return await enqueueRepoWriteOperation<RepoMutationResult>(
    cwd,
    signal,
    {
      repoId: cwd,
      workspaceRuntimeId: options.workspaceRuntimeId,
      kind: operationKind,
      source: 'user',
      target,
      canCancelUnderlying: true,
    },
    (_operation, context) => async () => {
      return await context.runWithRepoSource(
        async (source) => await context.runNetworkOperation(async (networkSignal) => await task(source, networkSignal)),
      )
    },
  )
}

function createWorktreeTargetBranch(input: CreateWorktreeInput): string {
  switch (input.mode.kind) {
    case 'newBranch':
      return input.mode.newBranch
    case 'existingBranch':
      return input.mode.branch
    case 'trackRemoteBranch':
      return input.mode.localBranch
  }
  const exhaustive: never = input.mode
  return exhaustive
}

async function runRepoServerWriteOperation<T extends ExecResult>(options: {
  repoId: WorkspaceId
  workspaceRuntimeId?: string
  kind: RepoServerOperationKind
  target?: RepoServerOperationTarget | null
  signal?: AbortSignal
  captureExecution?: (signal?: AbortSignal) => Promise<RepoWriteExecutionCapability>
  task: (context: RepoWriteOperationContext) => Promise<T>
}): Promise<T> {
  return await enqueueRepoWriteOperation(
    options.repoId,
    options.signal,
    {
      repoId: options.repoId,
      workspaceRuntimeId: options.workspaceRuntimeId,
      kind: options.kind,
      source: 'user',
      target: options.target,
      canCancelUnderlying: !!options.signal,
      captureExecution: options.captureExecution,
    },
    (operation, context) => async () => {
      const onAbort = () => {
        operation.requestCancel('caller-abort')
      }
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        operation.start()
        if (options.signal?.aborted) {
          const result = { ok: false, message: 'cancelled' } as T
          operation.settle(result)
          return result
        }
        const result = await options.task(context)
        operation.settle(result)
        return result
      } finally {
        options.signal?.removeEventListener('abort', onAbort)
      }
    },
  )
}

export async function fetchRepo(
  cwd: WorkspaceId,
  kind: NetworkOpKind = 'user',
  signal?: AbortSignal,
  workspaceRuntimeId?: string,
): Promise<RepoMutationResult> {
  return await enqueueRepoWriteOperation(
    cwd,
    signal,
    {
      repoId: cwd,
      workspaceRuntimeId,
      kind: 'fetch',
      source: kind,
      canCancelUnderlying: true,
    },
    (_operation, context) => async () =>
      await context.runWithRepoSource(async (source) => {
        return await context.runNetworkOperation(async (networkSignal) => await source.fetch(networkSignal))
      }),
  )
}

export async function pullRepoBranch(
  cwd: WorkspaceId,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoMutationResult> {
  return await runUserNetworkMutation(
    cwd,
    signal,
    'pull',
    { branch, worktreePath },
    async (source, mergedSignal) => {
      return await source.pull(branch, worktreePath, mergedSignal)
    },
    options,
  )
}

export async function pushRepoBranch(
  cwd: WorkspaceId,
  branch: string,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoMutationResult> {
  return await runUserNetworkMutation(
    cwd,
    signal,
    'push',
    { branch },
    async (source, mergedSignal) => {
      return await source.push(branch, mergedSignal)
    },
    options,
  )
}

export async function createRepoWorktree(
  cwd: WorkspaceId,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  options?: { workspaceRuntimeId?: string; worktreeBootstrap?: WorktreeBootstrapDecision },
): Promise<RepoMutationResult> {
  const repoId = toSafeWorkspaceLocator(cwd)
  if (!repoId) return { ok: false, message: 'error.invalid-arguments' }
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return { ok: false, message: 'error.invalid-arguments' }
  if (!path.isAbsolute(normalized.worktreePath) || /[\0-\x1f\x7f]/.test(normalized.worktreePath)) {
    return { ok: false, message: 'error.invalid-path' }
  }
  const worktreeBootstrap = options?.worktreeBootstrap ?? { kind: 'skip' }
  return await runRepoServerWriteOperation({
    repoId,
    workspaceRuntimeId: options?.workspaceRuntimeId,
    kind: 'create-worktree',
    target: { branch: createWorktreeTargetBranch(normalized), worktreePath: normalized.worktreePath },
    signal,
    task: async (context) => {
      return await context.runWithRepoSource(async (source) => {
        const result = await source.createWorktree(normalized, signal, {
          runMembershipMutation: context.runMembershipMutation,
          worktreeBootstrap,
        })
        if (!result.ok) return result
        try {
          await persistWorktreeBootstrapTrustChoice(repoId, worktreeBootstrap)
        } catch (error) {
          return worktreeFollowupFailure(result, error, 'error.worktree-created-followup-failed')
        }
        return result
      })
    },
  })
}

async function persistWorktreeBootstrapTrustChoice(
  repoId: WorkspaceId,
  decision: WorktreeBootstrapDecision,
): Promise<void> {
  if (decision.kind !== 'run') return
  const changed = await setServerWorkspaceWorktreeBootstrapConfigTrust({
    workspaceId: repoId,
    configHash: decision.configHash,
    trusted: decision.configTrusted,
  })
  // Settings and operation activity are independent projections of already
  // committed authority. Publishing settings first may create a brief visual
  // ordering difference, but neither projection authorizes the other; do not
  // add cross-projection settlement coordination for that harmless window.
  if (changed) publishSettingsInvalidation(['settings-snapshot'])
}

export async function getRepoRemoteBranches(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<RemoteTrackingBranchIdentity[]> {
  if (!isValidWorkspaceLocatorInput(cwd)) return []
  return await runWithRepoSource(
    cwd,
    async (source) => await source.getRemoteBranches(options.signal),
    options.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined,
  )
}

export async function deleteRepoBranch(
  cwd: WorkspaceId,
  branch: string,
  options?: { force?: boolean; deleteUpstream?: boolean },
  signal?: AbortSignal,
  runtime?: { workspaceRuntimeId?: string },
): Promise<RepoMutationResult> {
  return await runRepoServerWriteOperation({
    repoId: cwd,
    workspaceRuntimeId: runtime?.workspaceRuntimeId,
    kind: 'delete-branch',
    target: { branch },
    signal,
    task: async (context) => {
      return await context.runWithRepoSource(async (source) => {
        return await source.deleteBranch(branch, options, signal)
      })
    },
  })
}

export async function removeCapturedRepoWorktree(
  cwd: WorkspaceId,
  input: {
    branch: string
    worktreePath: string
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
  },
  lifecycle: RepoWorktreeRemovalLifecycle,
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoMutationResult> {
  return await removeRepoWorktreeWithBinding(cwd, input, lifecycle, signal, physicalWorktreeCapability, options)
}

async function removeRepoWorktreeWithBinding(
  cwd: WorkspaceId,
  input: {
    branch: string
    worktreePath: string
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
  },
  lifecycle: RepoWorktreeRemovalLifecycle,
  signal: AbortSignal | undefined,
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoMutationResult> {
  return await runRepoServerWriteOperation({
    repoId: cwd,
    workspaceRuntimeId: options.workspaceRuntimeId,
    kind: 'remove-worktree',
    target: { branch: input.branch, worktreePath: input.worktreePath },
    signal,
    captureExecution: async (captureSignal) =>
      await captureRepoWriteExecutionFromPhysicalWorktree(
        cwd,
        physicalWorktreeCapability,
        options.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined,
        captureSignal,
      ),
    task: async (context) => {
      return await context.runWithRepoSource(async (source) => {
        const settingsFollowup = removedWorktreeSettingsFollowup(cwd, input.worktreePath, lifecycle)
        try {
          const mutation = await source.removeWorktree(
            input,
            signal,
            settingsFollowup.lifecycle,
            context.runMembershipMutation,
          )
          return await settingsFollowup.settle(mutation)
        } catch (error) {
          if (!isRepoMutationRuntimeFailureError(error)) throw error
          const mutation = await settingsFollowup.settle(error.mutation)
          throw new RepoMutationRuntimeFailureError(mutation, error.runtimeFailure)
        }
      })
    },
  })
}

interface RemovedWorktreeSettingsFollowup {
  lifecycle: RepoWorktreeRemovalLifecycle
  settle(mutation: RepoMutationResult): Promise<RepoMutationResult>
}

function removedWorktreeSettingsFollowup(
  repoId: WorkspaceId,
  worktreePath: string,
  lifecycle: RepoWorktreeRemovalLifecycle,
): RemovedWorktreeSettingsFollowup {
  let removalCommitted = false
  return {
    lifecycle: {
      beforeRemove: lifecycle.beforeRemove,
      afterWorktreeRemoved: async () => {
        removalCommitted = true
        return await lifecycle.afterWorktreeRemoved()
      },
    },
    async settle(mutation) {
      if (!removalCommitted) return mutation
      try {
        const workspaceId = toSafeWorkspaceLocator(repoId)
        if (!workspaceId) throw new Error('invalid workspace id after repo mutation')
        const changed = await pruneServerWorkspaceSettingsForRemovedWorktree({ workspaceId, worktreePath })
        if (changed) publishSettingsInvalidation(['settings-snapshot'])
        return mutation
      } catch (error) {
        if (!mutation.ok) {
          repoWriteLogger.warn({ error, repoId, worktreePath }, 'failed to prune settings after worktree removal')
          return mutation
        }
        return worktreeFollowupFailure(mutation, error, 'error.worktree-removed-followup-failed')
      }
    },
  }
}

function worktreeFollowupFailure(
  mutation: RepoMutationResult,
  error: unknown,
  recoveryMessageKey: ExecResultRecoveryMessageKey,
): RepoMutationResult {
  const recoveryMessageKeys = appendRepoMutationRecoveryMessageKey(mutation.recoveryMessageKeys, recoveryMessageKey)
  const failure: RepoMutationResult = {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    recoveryMessageKeys,
  }
  if (mutation.worktreeBootstrap) failure.worktreeBootstrap = mutation.worktreeBootstrap
  if (mutation.repoIdsToInvalidate) failure.repoIdsToInvalidate = mutation.repoIdsToInvalidate
  if (mutation.worktreePathsToInvalidate) failure.worktreePathsToInvalidate = mutation.worktreePathsToInvalidate
  return failure
}

export async function openRepoUrl(
  cwd: WorkspaceId,
  target: RepoUrlTarget,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<ExecResult> {
  const url = await runWithRepoSource(
    cwd,
    async (source) => await source.getBrowserRepoUrl(target, signal),
    options.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined,
  )
  return url ? { ok: true, message: url } : { ok: false, message: 'error.no-remote-url' }
}
