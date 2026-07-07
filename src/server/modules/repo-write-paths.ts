import path from 'node:path'
import PQueue from 'p-queue'
import { runServerCancellable, abortServerNetworkOp } from '#/server/common/network-ops.ts'
import { publishRepoQueryInvalidation, publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  beginRepoServerOperation,
  createRepoServerOperationId,
  recordRepoServerOperationWaitCancellation,
  requestRepoServerOperationCancel,
  settleRepoServerOperation,
  startRepoServerOperation,
} from '#/server/modules/repo-operation-registry.ts'
import { resolveRepoSource, runWithRepoSource, type RepoMutationResult } from '#/server/modules/repo-source.ts'
import {
  getServerRepoSettings,
  pruneServerRepoSettingsForRemovedWorktree,
  trustServerRepoWorktreeBootstrapConfig,
  untrustServerRepoWorktreeBootstrapConfig,
} from '#/server/modules/settings-source.ts'
import { cloneRepo as cloneGitRepo } from '#/system/git/clone.ts'
import { openInPreferredEditor } from '#/system/editors.ts'
import { openInPreferredTerminal } from '#/system/terminals.ts'
import { openInFinder } from '#/system/finder.ts'
import { type ExecResult, type RepoUrlTarget } from '#/shared/git-types.ts'
import type { NetworkOpKind, RepoServerOperationKind, RepoServerOperationTarget } from '#/shared/api-types.ts'
import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import { checkGitAvailable } from '#/system/git/git-exec.ts'
import { isValidCwd, isValidRepoLocator, toSafeRepoLocator } from '#/shared/input-validation.ts'
import { isRepoWorktreeBootstrapConfigTrusted } from '#/shared/repo-settings.ts'
import { type CloneRepoResult } from '#/shared/api-types.ts'
import { normalizeCreateWorktreeInput, type CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { constants as fsConstants, promises as fs } from 'node:fs'
import type { WorktreeBootstrapDecision } from '#/shared/worktree-bootstrap-summary.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

const MAX_CLONE_URL_LENGTH = 4096
const MAX_CLONE_DIR_NAME_LENGTH = 255
const CLONE_URL_SCHEME_RE = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE_CLONE_URL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]+$/
const CLONE_OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const INVALIDATION_SOURCE_TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/
const activeCloneControllers = new Map<string, AbortController>()
const activeBackgroundFetches = new Map<
  string,
  { promise: Promise<{ ok: boolean; message: string }>; operationId: string }
>()
const repoWriteOperationQueuesByRepo = new Map<string, PQueue>()

type RepoExecResult = { ok: boolean; message: string }

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

function isValidCloneOperationId(value: unknown): value is string {
  return typeof value === 'string' && CLONE_OPERATION_ID_RE.test(value)
}

function normalizeInvalidationSourceToken(value: unknown): string | undefined {
  return typeof value === 'string' && INVALIDATION_SOURCE_TOKEN_RE.test(value) ? value : undefined
}

function repoSnapshotInvalidationEvent(cwd: string, sourceToken?: string) {
  const normalizedSourceToken = normalizeInvalidationSourceToken(sourceToken)
  return normalizedSourceToken
    ? { repoId: cwd, query: 'repo-snapshot' as const, sourceToken: normalizedSourceToken }
    : { repoId: cwd, query: 'repo-snapshot' as const }
}

function publishRepoSnapshotInvalidation(cwd: string, sourceToken?: string): void {
  publishRepoQueryInvalidation(repoSnapshotInvalidationEvent(cwd, sourceToken))
}

async function publishSnapshotInvalidationAfterMutation(
  cwd: string,
  result: RepoMutationResult,
  sourceToken?: string,
): Promise<ExecResult> {
  const affectedRepoIds = result.affectedRepoIds ?? []
  if (!result.ok && affectedRepoIds.length === 0) return execResultOnly(result)
  publishRepoSnapshotInvalidations(cwd, affectedRepoIds, sourceToken)
  return execResultOnly(result)
}

function publishRepoSnapshotInvalidations(cwd: string, affectedRepoIds: readonly string[], sourceToken?: string): void {
  const uniqueRepoIds = Array.from(new Set([cwd, ...affectedRepoIds].filter((repoId) => repoId.length > 0)))
  for (const repoId of uniqueRepoIds) {
    publishRepoSnapshotInvalidation(repoId, repoId === cwd ? sourceToken : undefined)
  }
}

function execResultOnly(result: RepoMutationResult & { affectedWorktreePaths?: readonly string[] }): ExecResult {
  const { affectedRepoIds: _affectedRepoIds, affectedWorktreePaths: _affectedWorktreePaths, ...execResult } = result
  return execResult
}

async function withMergedAbortSignal<T>(
  signals: Array<AbortSignal | undefined>,
  task: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const activeSignals = signals.filter((signal): signal is AbortSignal => !!signal)
  if (activeSignals.length <= 1) return await task(activeSignals[0])
  if (typeof AbortSignal.any === 'function') return await task(AbortSignal.any(activeSignals))
  const ctrl = new AbortController()
  const abort = (event: Event) => {
    ctrl.abort((event.target as AbortSignal | null)?.reason)
  }
  for (const signal of activeSignals) {
    if (signal.aborted) {
      ctrl.abort(signal.reason)
      return await task(ctrl.signal)
    }
    signal.addEventListener('abort', abort)
  }
  try {
    return await task(ctrl.signal)
  } finally {
    for (const signal of activeSignals) signal.removeEventListener('abort', abort)
  }
}

async function waitForResultOrCallerAbort<T extends RepoExecResult>(
  promise: Promise<T>,
  signal?: AbortSignal,
  operationId?: string,
): Promise<T> {
  if (!signal) return await promise
  if (signal.aborted) {
    if (operationId) recordRepoServerOperationWaitCancellation(operationId, 'caller-abort')
    return { ok: false, message: 'cancelled' } as T
  }
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      if (operationId) recordRepoServerOperationWaitCancellation(operationId, 'caller-abort')
      resolve({ ok: false, message: 'cancelled' } as T)
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (err) => {
        cleanup()
        reject(err)
      },
    )
  })
}

async function runUserNetworkMutation(
  cwd: string,
  signal: AbortSignal | undefined,
  sourceToken: string | undefined,
  operationKind: 'pull' | 'push',
  target: { branch?: string; worktreePath?: string } | null,
  task: (signal: AbortSignal | undefined) => Promise<ExecResult>,
): Promise<ExecResult> {
  return await publishSnapshotInvalidationAfterMutation(
    cwd,
    await runServerCancellable(cwd, 'user', async (networkSignal) => {
      return await withMergedAbortSignal([signal, networkSignal], task)
    }, {
      operationKind,
      target,
      callerSignal: signal,
    }),
    sourceToken,
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
  repoId: string
  kind: RepoServerOperationKind
  target?: RepoServerOperationTarget | null
  signal?: AbortSignal
  task: () => Promise<T>
}): Promise<T> {
  const operation = beginRepoServerOperation({
    repoId: options.repoId,
    kind: options.kind,
    source: 'user',
    target: options.target,
    canCancelUnderlying: !!options.signal,
  })
  const onAbort = () => {
    requestRepoServerOperationCancel(operation.id, 'caller-abort')
  }
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener('abort', onAbort, { once: true })
  const run = async () => {
    startRepoServerOperation(operation.id)
    if (options.signal?.aborted) {
      const result = { ok: false, message: 'cancelled' } as T
      settleRepoServerOperation(operation.id, result)
      return result
    }
    try {
      const result = await options.task()
      settleRepoServerOperation(operation.id, result)
      return result
    } catch (err) {
      settleRepoServerOperation(operation.id, {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
  return await runRepoWriteServiceOperation(options.repoId, run)
}

export async function cloneRepo(
  operationId: string,
  url: string,
  parentPath: string,
  directoryName: string,
  signal?: AbortSignal,
): Promise<CloneRepoResult> {
  if (!isValidCloneOperationId(operationId)) return { ok: false, message: 'error.invalid-arguments' }
  const repoUrl = typeof url === 'string' ? url.trim() : ''
  const targetParent = typeof parentPath === 'string' ? parentPath.trim() : ''
  const targetName = typeof directoryName === 'string' ? directoryName.trim() : ''
  if (!isValidCloneUrl(repoUrl) || !isValidCloneDirectoryName(targetName)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidCwd(targetParent)) return { ok: false, message: 'error.invalid-path' }
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (activeCloneControllers.has(operationId)) return { ok: false, message: 'error.network-op-in-progress' }
  const operation = beginRepoServerOperation({
    id: operationId,
    repoId: null,
    kind: 'clone',
    source: 'user',
    target: { parentPath: targetParent, directoryName: targetName },
    canCancelUnderlying: true,
  })
  const ctrl = new AbortController()
  activeCloneControllers.set(operationId, ctrl)
  startRepoServerOperation(operation.id)
  const settleClone = (result: CloneRepoResult): CloneRepoResult => {
    settleRepoServerOperation(operation.id, result)
    return result
  }
  try {
    return await withMergedAbortSignal([signal, ctrl.signal], async (mergedSignal) => {
      if (mergedSignal?.aborted) return settleClone({ ok: false, message: 'cancelled' })
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable.ok) return settleClone(gitAvailable)
      if (mergedSignal?.aborted) return settleClone({ ok: false, message: 'cancelled' })
      const writable = await ensureWritableDirectory(targetParent)
      if (!writable.ok) return settleClone(writable)
      if (mergedSignal?.aborted) return settleClone({ ok: false, message: 'cancelled' })
      return settleClone(await cloneGitRepo(targetParent, targetName, repoUrl, mergedSignal))
    })
  } catch (err) {
    settleRepoServerOperation(operation.id, {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    if (activeCloneControllers.get(operationId) === ctrl) activeCloneControllers.delete(operationId)
  }
}

export function abortCloneOperation(operationId: string): boolean {
  if (!isValidCloneOperationId(operationId)) return false
  const active = activeCloneControllers.get(operationId)
  if (!active) return false
  requestRepoServerOperationCancel(operationId, 'user-cancel')
  active.abort()
  return true
}

export async function fetchRepo(
  cwd: string,
  kind: NetworkOpKind = 'user',
  sourceToken?: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  async function runFetch(
    task: (signal: AbortSignal) => Promise<{ ok: boolean; message: string }>,
    operationId?: string,
  ) {
    const result = await runServerCancellable(
      cwd,
      kind,
      async (networkSignal) => {
        return await withMergedAbortSignal([signal, networkSignal], async (mergedSignal) => {
          return await task(mergedSignal ?? networkSignal)
        })
      },
      { operationId, operationKind: 'fetch', callerSignal: signal },
    )
    if (result.ok) publishRepoSnapshotInvalidation(cwd, sourceToken)
    return result
  }
  async function executeFetch(operationId?: string): Promise<{ ok: boolean; message: string }> {
    return await runWithRepoSource(cwd, async (source) => await runFetch((signal) => source.fetch(signal), operationId))
  }

  if (kind === 'user') {
    const backgroundFetch = activeBackgroundFetches.get(cwd)
    if (backgroundFetch) {
      return await waitForResultOrCallerAbort(backgroundFetch.promise, signal, backgroundFetch.operationId)
    }
    return await executeFetch()
  }

  const existingBackgroundFetch = activeBackgroundFetches.get(cwd)
  if (existingBackgroundFetch) {
    return await waitForResultOrCallerAbort(existingBackgroundFetch.promise, signal, existingBackgroundFetch.operationId)
  }
  const operationId = createRepoServerOperationId()
  const backgroundFetch = executeFetch(operationId).finally(() => {
    if (activeBackgroundFetches.get(cwd)?.promise === backgroundFetch) activeBackgroundFetches.delete(cwd)
  })
  activeBackgroundFetches.set(cwd, { promise: backgroundFetch, operationId })
  return await backgroundFetch
}

export async function pullRepoBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  const source = await resolveRepoSource(cwd)
  return await runUserNetworkMutation(cwd, signal, sourceToken, 'pull', { branch, worktreePath }, async (mergedSignal) => {
    return await source.pull(branch, worktreePath, mergedSignal)
  })
}

export async function pushRepoBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  const source = await resolveRepoSource(cwd)
  return await runUserNetworkMutation(cwd, signal, sourceToken, 'push', { branch }, async (mergedSignal) => {
    return await source.push(branch, mergedSignal)
  })
}

export async function createRepoWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  sourceToken?: string,
  options?: { worktreeBootstrap?: WorktreeBootstrapDecision },
): Promise<ExecResult> {
  if (!isValidRepoLocator(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const repoId = toSafeRepoLocator(cwd)
  if (!repoId) return { ok: false, message: 'error.invalid-arguments' }
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return { ok: false, message: 'error.invalid-arguments' }
  if (!path.isAbsolute(normalized.worktreePath) || /[\0-\x1f\x7f]/.test(normalized.worktreePath)) {
    return { ok: false, message: 'error.invalid-path' }
  }
  const worktreeBootstrap = options?.worktreeBootstrap ?? { kind: 'skip' }
  return await runRepoServerWriteOperation({
    repoId,
    kind: 'create-worktree',
    target: { branch: createWorktreeTargetBranch(normalized), worktreePath: normalized.worktreePath },
    signal,
    task: async () => {
      return await runWithRepoSource(cwd, async (source) => {
        const result = await source.createWorktree(normalized, signal, {
          worktreeBootstrap,
        })
        const trustSyncedResult = await syncWorktreeBootstrapTrustAfterSuccessfulRun(repoId, worktreeBootstrap, result)
        return await publishSnapshotInvalidationAfterMutation(cwd, trustSyncedResult, sourceToken)
      })
    },
  })
}

async function runRepoWriteServiceOperation<T>(repoId: string, task: () => Promise<T>): Promise<T> {
  // Git mutations for a repo share one service queue so server-observed
  // operation state and filesystem effects move in the same order.
  const queue = repoWriteOperationQueueForRepo(repoId)
  try {
    return await queue.add(task)
  } finally {
    scheduleRepoWriteOperationQueueCleanup(repoId, queue)
  }
}

function repoWriteOperationQueueForRepo(repoId: string): PQueue {
  let queue = repoWriteOperationQueuesByRepo.get(repoId)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    repoWriteOperationQueuesByRepo.set(repoId, queue)
  }
  return queue
}

function scheduleRepoWriteOperationQueueCleanup(repoId: string, queue: PQueue): void {
  void queue.onIdle().then(() => {
    if (repoWriteOperationQueuesByRepo.get(repoId) !== queue) return
    if (queue.size === 0 && queue.pending === 0) repoWriteOperationQueuesByRepo.delete(repoId)
  })
}

async function syncWorktreeBootstrapTrustAfterSuccessfulRun(
  repoId: string,
  decision: WorktreeBootstrapDecision,
  result: RepoMutationResult,
): Promise<RepoMutationResult> {
  if (!result.ok || decision.kind !== 'run') return result
  try {
    const repoSettings = await getServerRepoSettings()
    const currentlyTrusted = isRepoWorktreeBootstrapConfigTrusted(repoSettings, repoId, decision.configHash)
    if (decision.configTrusted) {
      if (currentlyTrusted) return result
      await trustServerRepoWorktreeBootstrapConfig({ repoId, configHash: decision.configHash })
      publishSettingsInvalidation(['settings-snapshot'])
      return result
    }
    if (!currentlyTrusted) return result
    if (await untrustServerRepoWorktreeBootstrapConfig({ repoId, configHash: decision.configHash })) {
      publishSettingsInvalidation(['settings-snapshot'])
    }
    return result
  } catch {
    return { ...result, ok: false, message: 'error.settings-write-title', repoChanged: true }
  }
}

export async function getRepoRemoteBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  if (!isValidRepoLocator(cwd)) return []
  return await runWithRepoSource(cwd, async (source) => await source.getRemoteBranches(signal))
}

export async function deleteRepoBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await runRepoServerWriteOperation({
    repoId: cwd,
    kind: 'delete-branch',
    target: { branch },
    signal,
    task: async () => {
      return await runWithRepoSource(cwd, async (source) => {
        return await publishSnapshotInvalidationAfterMutation(
          cwd,
          await source.deleteBranch(branch, options, signal),
          sourceToken,
        )
      })
    },
  })
}

export async function removeRepoWorktree(
  cwd: string,
  input: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
  },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await runRepoServerWriteOperation({
    repoId: cwd,
    kind: 'remove-worktree',
    target: { branch: input.branch, worktreePath: input.worktreePath },
    signal,
    task: async () => {
      return await runWithRepoSource(cwd, async (source) => {
        const result = await publishSnapshotInvalidationAfterMutation(
          cwd,
          await source.removeWorktree(input, signal),
          sourceToken,
        )
        if (!result.ok) return result
        try {
          const changed = await pruneServerRepoSettingsForRemovedWorktree({
            repoId: cwd,
            worktreePath: input.worktreePath,
          })
          if (changed) publishSettingsInvalidation(['settings-snapshot'])
          return result
        } catch {
          return { ...result, ok: false, message: 'error.settings-write-title', repoChanged: true }
        }
      })
    },
  })
}

export async function openRepoUrl(cwd: string, target: RepoUrlTarget, signal?: AbortSignal): Promise<ExecResult> {
  const url = await runWithRepoSource(cwd, async (source) => await source.getBrowserRepoUrl(target, signal))
  return url ? { ok: true, message: url } : { ok: false, message: 'error.no-remote-url' }
}

export async function openRepoTerminal(path: string, app: TerminalApp): Promise<ExecResult> {
  return await openInPreferredTerminal(path, app)
}

export async function openRepoEditor(path: string, app: EditorApp): Promise<ExecResult> {
  return await openInPreferredEditor(path, app)
}

export async function openRepoInFinder(path: string): Promise<ExecResult> {
  return await openInFinder(path)
}

export function abortRepoOperation(cwd: string): boolean {
  if (!isValidRepoLocator(cwd)) return false
  return abortServerNetworkOp(cwd)
}
