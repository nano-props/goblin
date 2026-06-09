import { runServerCancellable, abortServerNetworkOp } from '#/server/common/network-ops.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { resolveRepoBackend, runWithRepoBackend } from '#/server/modules/repo-backend.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import { cloneRepository as cloneGitRepository } from '#/system/git/clone.ts'
import { openInPreferredEditor } from '#/system/editors.ts'
import { openInPreferredTerminal } from '#/system/terminals.ts'
import { type ExecResult } from '#/shared/git-types.ts'
import { type NetworkOpKind } from '#/shared/rpc.ts'
import { checkGitAvailable } from '#/system/git/helper.ts'
import { isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import { type CloneRepoResult, type ProbeResult } from '#/shared/rpc.ts'
import { constants as fsConstants, promises as fs } from 'node:fs'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

const MAX_CLONE_URL_LENGTH = 4096
const MAX_CLONE_DIR_NAME_LENGTH = 255
const CLONE_URL_SCHEME_RE = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE_CLONE_URL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]+$/
const CLONE_OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const INVALIDATION_SOURCE_TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/
const activeCloneControllers = new Map<string, AbortController>()
const activeBackgroundFetches = new Map<string, Promise<{ ok: boolean; message: string }>>()

async function probeReadableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fsConstants.R_OK)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
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
  result: ExecResult,
  sourceToken?: string,
): Promise<ExecResult> {
  if (!result.ok) return result
  publishRepoSnapshotInvalidation(cwd, sourceToken)
  return result
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

async function runUserNetworkMutation(
  cwd: string,
  signal: AbortSignal | undefined,
  sourceToken: string | undefined,
  task: (signal: AbortSignal | undefined) => Promise<ExecResult>,
): Promise<ExecResult> {
  return await publishSnapshotInvalidationAfterMutation(
    cwd,
    await runServerCancellable(cwd, 'user', async (networkSignal) => {
      return await withMergedAbortSignal([signal, networkSignal], task)
    }),
    sourceToken,
  )
}

export async function cloneRepository(
  operationId: string,
  url: string,
  parentPath: string,
  directoryName: string,
): Promise<CloneRepoResult> {
  if (!isValidCloneOperationId(operationId)) return { ok: false, message: 'error.invalid-arguments' }
  const repoUrl = typeof url === 'string' ? url.trim() : ''
  const targetParent = typeof parentPath === 'string' ? parentPath.trim() : ''
  const targetName = typeof directoryName === 'string' ? directoryName.trim() : ''
  if (!isValidCloneUrl(repoUrl) || !isValidCloneDirectoryName(targetName)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidCwd(targetParent)) return { ok: false, message: 'error.invalid-path' }
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable.ok) return gitAvailable
  const writable = await ensureWritableDirectory(targetParent)
  if (!writable.ok) return writable
  if (activeCloneControllers.has(operationId)) return { ok: false, message: 'error.network-op-in-progress' }
  const ctrl = new AbortController()
  activeCloneControllers.set(operationId, ctrl)
  try {
    return await cloneGitRepository(targetParent, targetName, repoUrl, ctrl.signal)
  } finally {
    if (activeCloneControllers.get(operationId) === ctrl) activeCloneControllers.delete(operationId)
  }
}

export function abortCloneOperation(operationId: string): boolean {
  if (!isValidCloneOperationId(operationId)) return false
  const active = activeCloneControllers.get(operationId)
  if (!active) return false
  active.abort()
  return true
}

export async function fetchRepository(
  cwd: string,
  kind: NetworkOpKind = 'user',
  sourceToken?: string,
): Promise<{ ok: boolean; message: string }> {
  async function runFetch(task: (signal: AbortSignal) => Promise<{ ok: boolean; message: string }>) {
    const result = await runServerCancellable(cwd, kind, task)
    if (result.ok) publishRepoSnapshotInvalidation(cwd, sourceToken)
    return result
  }
  async function executeFetch(): Promise<{ ok: boolean; message: string }> {
    return await runWithRepoBackend(cwd, async (backend) => await runFetch((signal) => backend.fetch(signal)))
  }

  if (kind === 'user') {
    const backgroundFetch = activeBackgroundFetches.get(cwd)
    if (backgroundFetch) return await backgroundFetch
    return await executeFetch()
  }

  const existingBackgroundFetch = activeBackgroundFetches.get(cwd)
  if (existingBackgroundFetch) return await existingBackgroundFetch
  const backgroundFetch = executeFetch().finally(() => {
    if (activeBackgroundFetches.get(cwd) === backgroundFetch) activeBackgroundFetches.delete(cwd)
  })
  activeBackgroundFetches.set(cwd, backgroundFetch)
  return await backgroundFetch
}

export async function checkoutRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(cwd, await backend.checkout(branch, signal), sourceToken)
  })
}

export async function pullRepositoryBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  const backend = await resolveRepoBackend(cwd)
  return await runUserNetworkMutation(cwd, signal, sourceToken, async (mergedSignal) => {
    return await backend.pull(branch, worktreePath, mergedSignal)
  })
}

export async function pushRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  const backend = await resolveRepoBackend(cwd)
  return await runUserNetworkMutation(cwd, signal, sourceToken, async (mergedSignal) => {
    return await backend.push(branch, mergedSignal)
  })
}

export async function createRepositoryWorktree(
  cwd: string,
  worktreePath: string,
  newBranch: string,
  baseBranch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(
      cwd,
      await backend.createWorktree(worktreePath, newBranch, baseBranch, signal),
      sourceToken,
    )
  })
}

export async function deleteRepositoryBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(cwd, await backend.deleteBranch(branch, options, signal), sourceToken)
  })
}

export async function removeRepositoryWorktree(
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
  return await runWithRepoBackend(cwd, async (backend) => {
    return await publishSnapshotInvalidationAfterMutation(cwd, await backend.removeWorktree(input, signal), sourceToken)
  })
}

export async function openRepositoryRemote(cwd: string, branch?: string, signal?: AbortSignal): Promise<ExecResult> {
  const url = await runWithRepoBackend(cwd, async (backend) => await backend.getBrowserRemoteUrl(branch, signal))
  return url ? { ok: true, message: url } : { ok: false, message: 'error.no-remote-url' }
}

export async function openRepositoryTerminal(path: string): Promise<ExecResult> {
  const prefs = await getServerSettingsPrefs()
  return await openInPreferredTerminal(path, prefs.terminalApp)
}

export async function openRepositoryEditor(path: string): Promise<ExecResult> {
  const prefs = await getServerSettingsPrefs()
  return await openInPreferredEditor(path, prefs.editorApp)
}

export function abortRepositoryOperation(cwd: string): boolean {
  if (!isValidRepoLocator(cwd)) return false
  return abortServerNetworkOp(cwd)
}
