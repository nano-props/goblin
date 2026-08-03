import path from 'node:path'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { serverLogger } from '#/server/logger.ts'
import { publishRepoReadInvalidation, publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
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
import type { RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
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
import { type ExecResult, type RepoUrlTarget } from '#/shared/git-types.ts'
import type { NetworkOpKind, RepoServerOperationKind, RepoServerOperationTarget } from '#/shared/api-types.ts'
import { isValidWorkspaceLocatorInput, toSafeWorkspaceLocator } from '#/shared/input-validation.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RepoReadInvalidationDomain } from '#/shared/repo-read-invalidation.ts'
import { normalizeCreateWorktreeInput, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'

const repoWriteLogger = serverLogger.child({ module: 'repo-write-paths' })

function execResultAfterMutationInvalidations(
  workspaceId: WorkspaceId,
  result: RepoMutationResult,
  domains: readonly RepoReadInvalidationDomain[],
): ExecResult {
  return execResultOnly(publishMutationInvalidations(workspaceId, result, domains))
}

function publishMutationInvalidations(
  workspaceId: WorkspaceId,
  result: RepoMutationResult,
  domains: readonly RepoReadInvalidationDomain[],
): RepoMutationResult {
  const repoIdsToInvalidate = result.repoIdsToInvalidate ?? []
  if (repoIdsToInvalidate.length > 0) {
    const uniqueRepoIds = Array.from(new Set([workspaceId, ...repoIdsToInvalidate]))
    for (const repoId of uniqueRepoIds) {
      for (const domain of domains) publishRepoReadInvalidation({ repoId, domain })
    }
  }
  return result
}

async function runMutationWithInvalidations(
  workspaceId: WorkspaceId,
  domains: readonly RepoReadInvalidationDomain[],
  task: () => Promise<RepoMutationResult>,
): Promise<RepoMutationResult> {
  try {
    return publishMutationInvalidations(workspaceId, await task(), domains)
  } catch (error) {
    if (!isRepoMutationRuntimeFailureError(error)) throw error
    publishMutationInvalidations(workspaceId, error.mutation, domains)
    throw error.runtimeFailure
  }
}

function execResultOnly(result: RepoMutationResult): ExecResult {
  if (result.worktreeBootstrap) {
    return {
      ok: result.ok,
      message: result.message,
      worktreeBootstrap: result.worktreeBootstrap,
    }
  }
  return {
    ok: result.ok,
    message: result.message,
  }
}

async function runUserNetworkMutation(
  cwd: WorkspaceId,
  signal: AbortSignal | undefined,
  operationKind: 'pull' | 'push',
  invalidatedDomains: readonly RepoReadInvalidationDomain[],
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
      return await runMutationWithInvalidations(cwd, invalidatedDomains, async () => {
        return await context.runWithRepoSource(
          async (source) =>
            await context.runNetworkOperation(async (networkSignal) => await task(source, networkSignal)),
        )
      })
    },
  )
}

export interface RepoFilesystemMutationOutcome extends ExecResult {
  worktreePathsToInvalidate?: readonly string[]
}

function filesystemMutationOutcome(result: RepoMutationResult): RepoFilesystemMutationOutcome {
  return {
    ok: result.ok,
    message: result.message,
    worktreePathsToInvalidate: result.worktreePathsToInvalidate,
  }
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
    (operation, context) => {
      const onAbort = () => {
        operation.requestCancel('caller-abort')
      }
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
      return async () => {
        operation.start()
        if (options.signal?.aborted) {
          const result = { ok: false, message: 'cancelled' } as T
          operation.settle(result)
          return result
        }
        try {
          const result = await options.task(context)
          operation.settle(result)
          return result
        } catch (err) {
          operation.settle({
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          })
          throw err
        } finally {
          options.signal?.removeEventListener('abort', onAbort)
        }
      }
    },
  )
}

export async function fetchRepo(
  cwd: WorkspaceId,
  kind: NetworkOpKind = 'user',
  signal?: AbortSignal,
  workspaceRuntimeId?: string,
): Promise<ExecResult> {
  async function runFetch(
    task: (signal: AbortSignal) => Promise<RepoMutationResult>,
    context: RepoWriteOperationContext,
  ) {
    const result = await runMutationWithInvalidations(cwd, ['metadata'], async () => {
      return await context.runNetworkOperation(async (networkSignal) => await task(networkSignal))
    })
    return execResultOnly(result)
  }
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
      await context.runWithRepoSource(async (source) => await runFetch((signal) => source.fetch(signal), context)),
  )
}

export async function pullRepoBranch(
  cwd: WorkspaceId,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoFilesystemMutationOutcome> {
  return filesystemMutationOutcome(
    await runUserNetworkMutation(
      cwd,
      signal,
      'pull',
      ['metadata', 'worktree-status'],
      { branch, worktreePath },
      async (source, mergedSignal) => {
        return await source.pull(branch, worktreePath, mergedSignal)
      },
      options,
    ),
  )
}

export async function pushRepoBranch(
  cwd: WorkspaceId,
  branch: string,
  signal?: AbortSignal,
  options: { workspaceRuntimeId?: string } = {},
): Promise<ExecResult> {
  return execResultOnly(
    await runUserNetworkMutation(
      cwd,
      signal,
      'push',
      ['metadata'],
      { branch },
      async (source, mergedSignal) => {
        return await source.push(branch, mergedSignal)
      },
      options,
    ),
  )
}

export async function createRepoWorktree(
  cwd: WorkspaceId,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  options?: { workspaceRuntimeId?: string; worktreeBootstrap?: WorktreeBootstrapDecision },
): Promise<ExecResult> {
  const repoId = toSafeWorkspaceLocator(cwd)
  if (!repoId) return { ok: false, message: 'error.invalid-arguments' }
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return { ok: false, message: 'error.invalid-arguments' }
  if (!path.isAbsolute(normalized.worktreePath) || /[\0-\x1f\x7f]/.test(normalized.worktreePath)) {
    return { ok: false, message: 'error.invalid-path' }
  }
  const worktreeBootstrap = options?.worktreeBootstrap ?? { kind: 'skip' }
  const mutation = await runMutationWithInvalidations(cwd, ['metadata', 'worktree-status'], async () => {
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
          } catch {
            return { ...result, ok: false, message: 'error.worktree-created-followup-failed' }
          }
          return result
        })
      },
    })
  })
  return execResultOnly(mutation)
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
): Promise<ExecResult> {
  const mutation = await runMutationWithInvalidations(cwd, ['metadata'], async () => {
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
  })
  return execResultOnly(mutation)
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
): Promise<ExecResult> {
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
): Promise<ExecResult> {
  const mutation = await runMutationWithInvalidations(cwd, ['metadata', 'worktree-status'], async () => {
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
          try {
            const mutation = await source.removeWorktree(input, signal, lifecycle, context.runMembershipMutation)
            return await pruneRemovedWorktreeSettings(cwd, input.worktreePath, mutation)
          } catch (error) {
            if (!isRepoMutationRuntimeFailureError(error)) throw error
            const mutation = await pruneRemovedWorktreeSettings(cwd, input.worktreePath, error.mutation)
            throw new RepoMutationRuntimeFailureError(mutation, error.runtimeFailure)
          }
        })
      },
    })
  })
  return execResultOnly(mutation)
}

async function pruneRemovedWorktreeSettings(
  repoId: WorkspaceId,
  worktreePath: string,
  mutation: RepoMutationResult,
): Promise<RepoMutationResult> {
  if (mutation.worktreeRemoved !== true) return mutation
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
    return { ...mutation, ok: false, message: 'error.worktree-removed-followup-failed' }
  }
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
