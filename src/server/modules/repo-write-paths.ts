import path from 'node:path'
import { omit } from 'es-toolkit'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { serverLogger } from '#/server/logger.ts'
import { publishRepoQueryInvalidation, publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  beginRepoServerOperation,
  requestRepoServerOperationCancel,
  settleRepoServerOperation,
  startRepoServerOperation,
} from '#/server/modules/repo-operation-registry.ts'
import {
  captureRepoWriteExecutionFromPhysicalWorktree,
  runWithRepoSource,
  type RepoMutationResult,
  type RepoSource,
  type RepoWriteExecutionCapability,
} from '#/server/modules/repo-source.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { RemoteTrackingBranchIdentity } from '#/shared/worktree-create.ts'
import {
  enqueueRepoWriteOperation,
  type RepoWriteOperationContext,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import {
  getServerWorkspaceSettings,
  pruneServerWorkspaceSettingsForRemovedWorktree,
  trustServerWorkspaceWorktreeBootstrapConfig,
  untrustServerWorkspaceWorktreeBootstrapConfig,
} from '#/server/modules/settings-source.ts'
import { cloneRepo as cloneGitRepo } from '#/system/git/clone.ts'
import { type ExecResult, type RepoUrlTarget } from '#/shared/git-types.ts'
import type { NetworkOpKind, RepoServerOperationKind, RepoServerOperationTarget } from '#/shared/api-types.ts'
import { checkGitAvailable } from '#/system/git/git-exec.ts'
import { isValidCwd, isValidWorkspaceLocatorInput, toSafeWorkspaceLocator } from '#/shared/input-validation.ts'
import { isWorkspaceWorktreeBootstrapConfigTrusted } from '#/shared/workspace-settings.ts'
import { type CloneRepoResult } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { normalizeCreateWorktreeInput, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { constants as fsConstants, promises as fs } from 'node:fs'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

const MAX_CLONE_URL_LENGTH = 4096
const MAX_CLONE_DIR_NAME_LENGTH = 255
const repoWriteLogger = serverLogger.child({ module: 'repo-write-paths' })
const CLONE_URL_SCHEME_RE = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE_CLONE_URL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]+$/

async function probeWritableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fsConstants.R_OK | fsConstants.W_OK)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
}

async function ensureWritableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    await fs.mkdir(cwd, { recursive: true })
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
  return await probeWritableDirectory(cwd)
}

function classifyPathProbeError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOENT') return 'error.path-not-found'
  if (code === 'ENOTDIR') return 'error.path-not-directory'
  if (code === 'EACCES' || code === 'EPERM') return 'error.path-permission-denied'
  return 'error.invalid-path'
}

function isValidCloneUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLONE_URL_LENGTH &&
    !/[\0-\x1f\x7f]/.test(value) &&
    (CLONE_URL_SCHEME_RE.test(value) || SCP_LIKE_CLONE_URL_RE.test(value))
  )
}

function isValidCloneDirectoryName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLONE_DIR_NAME_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/:\0]/.test(value)
  )
}

function repoSnapshotInvalidationEvent(workspaceId: WorkspaceId) {
  return { repoId: workspaceId, query: 'repo-snapshot' as const }
}

function publishRepoSnapshotInvalidation(workspaceId: WorkspaceId): void {
  publishRepoQueryInvalidation(repoSnapshotInvalidationEvent(workspaceId))
}

async function publishSnapshotInvalidationAfterMutation(
  workspaceId: WorkspaceId,
  result: RepoMutationResult,
): Promise<ExecResult> {
  return execResultOnly(publishSnapshotInvalidationForMutation(workspaceId, result))
}

function publishSnapshotInvalidationForMutation(
  workspaceId: WorkspaceId,
  result: RepoMutationResult,
): RepoMutationResult {
  const affectedRepoIds = result.affectedRepoIds ?? []
  if (result.ok || result.repositoryStateChanged || affectedRepoIds.length > 0) {
    publishRepoSnapshotInvalidations(workspaceId, affectedRepoIds)
  }
  return result
}

function publishRepoSnapshotInvalidations(workspaceId: WorkspaceId, affectedRepoIds: readonly WorkspaceId[]): void {
  const uniqueRepoIds = Array.from(new Set([workspaceId, ...affectedRepoIds]))
  for (const repoId of uniqueRepoIds) {
    publishRepoSnapshotInvalidation(repoId)
  }
}

function execResultOnly(result: RepoMutationResult & { affectedWorktreePaths?: readonly string[] }): ExecResult {
  return omit(result, ['affectedRepoIds', 'affectedWorktreePaths'])
}

async function runUserNetworkMutation(
  cwd: WorkspaceId,
  signal: AbortSignal | undefined,
  operationKind: 'pull' | 'push',
  target: { branch?: string; worktreePath?: string } | null,
  task: (source: RepoSource, signal: AbortSignal | undefined) => Promise<RepoMutationResult>,
  options: { workspaceRuntimeId?: string } = {},
): Promise<RepoMutationResult> {
  return publishSnapshotInvalidationForMutation(
    cwd,
    await enqueueRepoWriteOperation<RepoMutationResult>(
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
      (_operation, context) => async () =>
        await context.runWithRepoSource(
          async (source) =>
            await context.runNetworkOperation(async (networkSignal) => await task(source, networkSignal)),
        ),
    ),
  )
}

export interface RepoFilesystemMutationOutcome extends ExecResult {
  affectedWorktreePaths?: readonly string[]
}

function filesystemMutationOutcome(result: RepoMutationResult): RepoFilesystemMutationOutcome {
  return omit(result, ['affectedRepoIds'])
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

export async function cloneRepo(
  url: string,
  parentPath: string,
  directoryName: string,
  signal?: AbortSignal,
): Promise<CloneRepoResult> {
  const repoUrl = typeof url === 'string' ? url.trim() : ''
  const targetParent = typeof parentPath === 'string' ? parentPath.trim() : ''
  const targetName = typeof directoryName === 'string' ? directoryName.trim() : ''
  if (!isValidCloneUrl(repoUrl) || !isValidCloneDirectoryName(targetName)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidCwd(targetParent)) return { ok: false, message: 'error.invalid-path' }
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const operation = beginRepoServerOperation({
    repoId: null,
    kind: 'clone',
    source: 'user',
    target: { parentPath: targetParent, directoryName: targetName },
    canCancelUnderlying: !!signal,
  })
  const onAbort = () => {
    requestRepoServerOperationCancel(operation.id, 'caller-abort')
  }
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  startRepoServerOperation(operation.id)
  const settleClone = (result: CloneRepoResult): CloneRepoResult => {
    settleRepoServerOperation(operation.id, result)
    return result
  }
  try {
    if (signal?.aborted) return settleClone({ ok: false, message: 'cancelled' })
    const gitAvailable = await checkGitAvailable()
    if (!gitAvailable.ok) return settleClone(gitAvailable)
    if (signal?.aborted) return settleClone({ ok: false, message: 'cancelled' })
    const writable = await ensureWritableDirectory(targetParent)
    if (!writable.ok) return settleClone(writable)
    if (signal?.aborted) return settleClone({ ok: false, message: 'cancelled' })
    return settleClone(await cloneGitRepo(targetParent, targetName, repoUrl, signal))
  } catch (err) {
    settleRepoServerOperation(operation.id, {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function fetchRepo(
  cwd: WorkspaceId,
  kind: NetworkOpKind = 'user',
  signal?: AbortSignal,
  workspaceRuntimeId?: string,
): Promise<{ ok: boolean; message: string }> {
  async function runFetch(
    task: (signal: AbortSignal) => Promise<RepoMutationResult>,
    context: RepoWriteOperationContext,
  ) {
    const result = await context.runNetworkOperation(async (networkSignal) => await task(networkSignal))
    return await publishSnapshotInvalidationAfterMutation(cwd, result)
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
  return await runRepoServerWriteOperation({
    repoId,
    workspaceRuntimeId: options?.workspaceRuntimeId,
    kind: 'create-worktree',
    target: { branch: createWorktreeTargetBranch(normalized), worktreePath: normalized.worktreePath },
    signal,
    task: async (context) => {
      return await context.runWithRepoSource(async (source) => {
        const result = await source.createWorktree(normalized, signal, {
          worktreeBootstrap,
        })
        const trustSyncedResult = await syncWorktreeBootstrapTrustAfterSuccessfulRun(repoId, worktreeBootstrap, result)
        return await publishSnapshotInvalidationAfterMutation(cwd, trustSyncedResult)
      })
    },
  })
}

async function syncWorktreeBootstrapTrustAfterSuccessfulRun(
  repoId: WorkspaceId,
  decision: WorktreeBootstrapDecision,
  result: RepoMutationResult,
): Promise<RepoMutationResult> {
  if (!result.ok || decision.kind !== 'run') return result
  try {
    const workspaceSettings = await getServerWorkspaceSettings()
    const currentlyTrusted = isWorkspaceWorktreeBootstrapConfigTrusted(workspaceSettings, repoId, decision.configHash)
    if (decision.configTrusted) {
      if (currentlyTrusted) return result
      await trustServerWorkspaceWorktreeBootstrapConfig({ workspaceId: repoId, configHash: decision.configHash })
      publishSettingsInvalidation(['settings-snapshot'])
      return result
    }
    if (!currentlyTrusted) return result
    if (await untrustServerWorkspaceWorktreeBootstrapConfig({ workspaceId: repoId, configHash: decision.configHash })) {
      publishSettingsInvalidation(['settings-snapshot'])
    }
    return result
  } catch {
    return { ...result, ok: false, message: 'error.settings-write-title', repositoryStateChanged: true }
  }
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
  return await runRepoServerWriteOperation({
    repoId: cwd,
    workspaceRuntimeId: runtime?.workspaceRuntimeId,
    kind: 'delete-branch',
    target: { branch },
    signal,
    task: async (context) => {
      return await context.runWithRepoSource(async (source) => {
        return await publishSnapshotInvalidationAfterMutation(cwd, await source.deleteBranch(branch, options, signal))
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
        const mutation = await source.removeWorktree(input, signal, lifecycle)
        const result = await publishSnapshotInvalidationAfterMutation(cwd, mutation)
        if (!mutation.ok && !mutation.repositoryStateChanged) return result
        try {
          const workspaceId = toSafeWorkspaceLocator(cwd)
          if (!workspaceId) throw new Error('invalid workspace id after repo mutation')
          const changed = await pruneServerWorkspaceSettingsForRemovedWorktree({
            workspaceId,
            worktreePath: input.worktreePath,
          })
          if (changed) publishSettingsInvalidation(['settings-snapshot'])
        } catch (error) {
          if (!result.ok) {
            repoWriteLogger.warn(
              { error, repoId: cwd, worktreePath: input.worktreePath },
              'failed to prune settings after worktree removal',
            )
            return result
          }
          return { ...result, ok: false, message: 'error.settings-write-title', repositoryStateChanged: true }
        }
        return result
      })
    },
  })
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
