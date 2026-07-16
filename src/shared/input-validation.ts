import path from 'node:path'
import { MAX_REPO_LOCATOR_LENGTH } from '#/shared/repo-locator.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  isRemoteRepoId,
  normalizeRemoteRepoRef,
  normalizeRepoSessionEntry,
  parseRemoteRepoId,
  type RepoSessionEntry,
} from '#/shared/remote-repo.ts'
import { parseWorkspaceLocator, type WorkspaceLocatorPlatform } from '#/shared/workspace-locator.ts'

export const MAX_IPC_PATH_LENGTH = MAX_REPO_LOCATOR_LENGTH
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
  return path.normalize(value)
}

export function isValidRepoLocator(value: unknown): value is string {
  return toSafeRepoLocator(value) !== null
}

export function toSafeRepoLocator(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IPC_PATH_LENGTH || value.includes('\0')) {
    return null
  }
  return parseWorkspaceLocator(value, currentPlatform()) ? value : null
}

export function toSafeSessionRepoEntry(value: unknown): RepoSessionEntry | null {
  const entry = normalizeRepoSessionEntry(value)
  const id = toSafeRepoLocator(entry?.id ?? value)
  if (!id) return null
  if (!isRemoteRepoId(id)) return entry?.kind === 'local' ? { kind: 'local', id } : null
  const parsed = parseRemoteRepoId(id)
  const ref = parsed ? normalizeRemoteRepoRef(parsed) : null
  return ref && entry?.kind === 'remote' && entry.ref.id === id ? { kind: 'remote', id: ref.id, ref } : null
}

function currentPlatform(): WorkspaceLocatorPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

export function isValidBranch(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_IPC_BRANCH_LENGTH && isSafeBranchName(value)
  )
}

export function isValidOptionalBranch(value: unknown): value is string | undefined {
  return value === undefined || isValidBranch(value)
}
