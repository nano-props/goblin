import path from 'node:path'
import { publishRepoQueryInvalidation, publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  beginRepoServerOperation,
  requestRepoServerOperationCancel,
  settleRepoServerOperation,
  startRepoServerOperation,
} from '#/server/modules/repo-operation-registry.ts'
import {
  resolveRepoWriteBoundaryAliases,
  resolveRepoWriteBoundaryKey,
  resolveRepoSource,
  runWithRepoSource,
  type RepoMutationResult,
} from '#/server/modules/repo-source.ts'
import {
  abortRepoWriteNetworkOperation,
  enqueueRepoWriteOperation,
  type RepoWriteOperationLifecycle,
  type RepoWriteOperationContext,
} from '#/server/modules/repo-write-operation-coordinator.ts'
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
interface ActiveBackgroundFetch {
  promise: Promise<{ ok: boolean; message: string }>
  operationRef: { current: RepoWriteOperationLifecycle | null }
  keys: readonly string[]
}

const activeBackgroundFetches = new Map<string, ActiveBackgroundFetch>()

type RepoExecResult = { ok: boolean; message: string }

function activeBackgroundFetchFor(keys: readonly string[]): ActiveBackgroundFetch | null {
  for (const key of keys) {
    const active = activeBackgroundFetches.get(key)
    if (active) return active
  }
  return null
}

function setActiveBackgroundFetch(active: ActiveBackgroundFetch): void {
  for (const key of active.keys) activeBackgroundFetches.set(key, active)
}

function deleteActiveBackgroundFetch(active: ActiveBackgroundFetch): void {
  for (const key of active.keys) {
    if (activeBackgroundFetches.get(key) === active) activeBackgroundFetches.delete(key)
  }
}

function registerActiveBackgroundFetch(
  keys: readonly string[],
  operationRef: ActiveBackgroundFetch['operationRef'],
  run: () => Promise<{ ok: boolean; message: string }>,
): ActiveBackgroundFetch {
  let active!: ActiveBackgroundFetch
  const promise = Promise.resolve()
    .then(run)
    .finally(() => {
      deleteActiveBackgroundFetch(active)
    })
  active = { promise, operationRef, keys }
  setActiveBackgroundFetch(active)
  return active
}

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

function repoSnapshotInvalidationEvent(cwd: string) {
  return { repoId: cwd, query: 'repo-snapshot' as const }
}

function publishRepoSnapshotInvalidation(cwd: string): void {
  publishRepoQueryInvalidation(repoSnapshotInvalidationEvent(cwd))
}

async function publishSnapshotInvalidationAfterMutation(cwd: string, result: RepoMutationResult): Promise<ExecResult> {
  const affectedRepoIds = result.affectedRepoIds ?? []
  if (!result.ok && affectedRepoIds.length === 0) return execResultOnly(result)
  publishRepoSnapshotInvalidations(cwd, affectedRepoIds)
  return execResultOnly(result)
}

function publishRepoSnapshotInvalidations(cwd: string, affectedRepoIds: readonly string[]): void {
  const uniqueRepoIds = Array.from(new Set([cwd, ...affectedRepoIds].filter((repoId) => repoId.length > 0)))
  for (const repoId of uniqueRepoIds) {
    publishRepoSnapshotInvalidation(repoId)
  }
}

function execResultOnly(result: RepoMutationResult & { affectedWorktreePaths?: readonly string[] }): ExecResult {
  const { affectedRepoIds: _affectedRepoIds, affectedWorktreePaths: _affectedWorktreePaths, ...execResult } = result
  return execResult
}

async function waitForResultOrCallerAbort<T extends RepoExecResult>(
  promise: Promise<T>,
  signal?: AbortSignal,
  operationRef?: { current: RepoWriteOperationLifecycle | null },
): Promise<T> {
  if (!signal) return await promise
  if (signal.aborted) {
    operationRef?.current?.recordWaitCancellation('caller-abort')
    return { ok: false, message: 'cancelled' } as T
  }
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      operationRef?.current?.recordWaitCancellation('caller-abort')
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
  operationKind: 'pull' | 'push',
  target: { branch?: string; worktreePath?: string } | null,
  task: (signal: AbortSignal | undefined) => Promise<ExecResult>,
): Promise<ExecResult> {
  return await publishSnapshotInvalidationAfterMutation(
    cwd,
    await enqueueRepoWriteOperation(
      cwd,
      signal,
      {
        repoId: cwd,
        kind: operationKind,
        source: 'user',
        target,
        canCancelUnderlying: true,
      },
      (_operation, context) => async () =>
        await context.runNetworkOperation(async (networkSignal) => await task(networkSignal)),
    ),
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
  return await enqueueRepoWriteOperation(
    options.repoId,
    options.signal,
    {
      repoId: options.repoId,
      kind: options.kind,
      source: 'user',
      target: options.target,
      canCancelUnderlying: !!options.signal,
    },
    (operation) => {
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
          const result = await options.task()
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
  cwd: string,
  kind: NetworkOpKind = 'user',
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  const backgroundFetchKey = await resolveRepoWriteBoundaryKey(cwd, signal)
  const backgroundFetchKeys = await resolveRepoWriteBoundaryAliases(cwd, backgroundFetchKey, signal)

  async function runFetch(
    task: (signal: AbortSignal) => Promise<RepoMutationResult>,
    context: RepoWriteOperationContext,
  ) {
    const result = await context.runNetworkOperation(async (networkSignal) => await task(networkSignal))
    return await publishSnapshotInvalidationAfterMutation(cwd, result)
  }
  async function executeFetch(
    operationRef?: { current: RepoWriteOperationLifecycle | null },
  ): Promise<{ ok: boolean; message: string }> {
    return await enqueueRepoWriteOperation(
      cwd,
      signal,
      {
        repoId: cwd,
        kind: 'fetch',
        source: kind,
        canCancelUnderlying: true,
      },
      (operation, context) => {
        if (operationRef) operationRef.current = operation
        return async () =>
          await runWithRepoSource(
            cwd,
            async (source) => await runFetch((signal) => source.fetch(signal), context),
          )
      },
      { boundaryKey: backgroundFetchKey },
    )
  }

  if (kind === 'user') {
    const backgroundFetch = activeBackgroundFetchFor(backgroundFetchKeys)
    if (backgroundFetch) {
      return await waitForResultOrCallerAbort(backgroundFetch.promise, signal, backgroundFetch.operationRef)
    }
    return await executeFetch()
  }

  const existingBackgroundFetch = activeBackgroundFetchFor(backgroundFetchKeys)
  if (existingBackgroundFetch) {
    return await waitForResultOrCallerAbort(existingBackgroundFetch.promise, signal, existingBackgroundFetch.operationRef)
  }
  const operationRef = { current: null as RepoWriteOperationLifecycle | null }
  const active = registerActiveBackgroundFetch(
    backgroundFetchKeys,
    operationRef,
    async () => await executeFetch(operationRef),
  )
  return await active.promise
}

export async function pullRepoBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const source = await resolveRepoSource(cwd)
  return await runUserNetworkMutation(cwd, signal, 'pull', { branch, worktreePath }, async (mergedSignal) => {
    return await source.pull(branch, worktreePath, mergedSignal)
  })
}

export async function pushRepoBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const source = await resolveRepoSource(cwd)
  return await runUserNetworkMutation(cwd, signal, 'push', { branch }, async (mergedSignal) => {
    return await source.push(branch, mergedSignal)
  })
}

export async function createRepoWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
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
        return await publishSnapshotInvalidationAfterMutation(cwd, trustSyncedResult)
      })
    },
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
): Promise<ExecResult> {
  return await runRepoServerWriteOperation({
    repoId: cwd,
    kind: 'delete-branch',
    target: { branch },
    signal,
    task: async () => {
      return await runWithRepoSource(cwd, async (source) => {
        return await publishSnapshotInvalidationAfterMutation(cwd, await source.deleteBranch(branch, options, signal))
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
): Promise<ExecResult> {
  return await runRepoServerWriteOperation({
    repoId: cwd,
    kind: 'remove-worktree',
    target: { branch: input.branch, worktreePath: input.worktreePath },
    signal,
    task: async () => {
      return await runWithRepoSource(cwd, async (source) => {
        const result = await publishSnapshotInvalidationAfterMutation(cwd, await source.removeWorktree(input, signal))
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

export async function abortRepoOperation(cwd: string): Promise<boolean> {
  if (!isValidRepoLocator(cwd)) return false
  return await abortRepoWriteNetworkOperation(cwd)
}
