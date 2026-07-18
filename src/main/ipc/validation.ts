import path from 'node:path'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  isRemoteWorkspaceId,
  normalizeRemoteWorkspaceRef,
  normalizeWorkspaceSessionEntry,
  parseRemoteWorkspaceId,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import {
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'

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
  // Native execution and worktree presentation boundaries still carry paths.
  // Workspace identity is validated separately as a canonical locator.
  return path.normalize(value)
}

export function isValidRepoLocator(value: unknown): value is string {
  return toSafeRepoLocator(value) !== null
}

export function toSafeRepoLocator(value: unknown): WorkspaceId | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IPC_PATH_LENGTH || value.includes('\0')) {
    return null
  }
  const platform = currentPlatform()
  const parsed = parseWorkspaceLocator(value, platform)
  return parsed ? formatWorkspaceLocator(parsed, platform) : null
}

export function toSafeSessionRepoEntry(value: unknown): WorkspaceSessionEntry | null {
  const entry = normalizeWorkspaceSessionEntry(value)
  const id = toSafeRepoLocator(entry?.id ?? value)
  if (!id) return null
  if (!isRemoteWorkspaceId(id)) return entry?.kind === 'local' ? { kind: 'local', id } : null
  const parsed = parseRemoteWorkspaceId(id)
  const ref = parsed ? normalizeRemoteWorkspaceRef(parsed) : null
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
