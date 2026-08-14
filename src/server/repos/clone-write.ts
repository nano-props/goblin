import { constants as fsConstants, promises as fs } from 'node:fs'
import { cloneRepo as cloneGitRepo } from '#/system/git/clone.ts'
import { checkGitAvailable } from '#/system/git/git-exec.ts'
import { isValidCwd } from '#/shared/input-validation.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

const MAX_CLONE_URL_LENGTH = 4096
const MAX_CLONE_DIR_NAME_LENGTH = 255
const CLONE_URL_SCHEME_RE = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE_CLONE_URL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]+$/

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
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable.ok) return gitAvailable
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  const writable = await ensureWritableDirectory(targetParent)
  if (!writable.ok) return writable
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  return await cloneGitRepo(targetParent, targetName, repoUrl, signal)
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
