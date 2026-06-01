import path from 'node:path'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { isRemoteRepoId, normalizeRemoteRepoRef, normalizeRepoSessionEntry, parseRemoteRepoId, type RepoSessionEntry } from '#/shared/remote-repo.ts'

export const MAX_IPC_PATH_LENGTH = 4096
export const MAX_IPC_BRANCH_LENGTH = 1024

export function isValidAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IPC_PATH_LENGTH &&
    !value.includes('\0') &&
    path.isAbsolute(value)
  )
}

export function isValidCwd(value: unknown): value is string {
  return isValidAbsolutePath(value)
}

export function toSafeSessionPath(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IPC_PATH_LENGTH ||
    value.includes('\0') ||
    !path.isAbsolute(value)
  )
    return null
  // Session/recent-repo entries are persisted local paths, not a sandbox
  // boundary. Repo probes still decide whether the normalized path is usable.
  return path.normalize(value)
}

export function isValidRepoLocator(value: unknown): value is string {
  return toSafeRepoLocator(value) !== null
}

export function toSafeRepoLocator(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IPC_PATH_LENGTH || value.includes('\0')) {
    return null
  }
  if (path.isAbsolute(value)) return path.normalize(value)
  return isRemoteRepoId(value) ? value : null
}

export function toSafeSessionRepoEntry(value: unknown): RepoSessionEntry | null {
  const entry = normalizeRepoSessionEntry(value)
  if (entry) return entry
  const id = toSafeRepoLocator(value)
  if (!id) return null
  if (!isRemoteRepoId(id)) return { kind: 'local', id }
  const parsed = parseRemoteRepoId(id)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  return ref ? { kind: 'remote', id: ref.id, ref } : null
}

export function isValidBranch(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_IPC_BRANCH_LENGTH && isSafeBranchName(value)
  )
}

export function isValidOptionalBranch(value: unknown): value is string | undefined {
  return value === undefined || isValidBranch(value)
}
