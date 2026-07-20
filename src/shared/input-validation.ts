import path from 'node:path'
import { MAX_WORKSPACE_LOCATOR_LENGTH } from '#/shared/workspace-locator.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { normalizeWorkspaceSessionEntry, type WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import {
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'

export const MAX_IPC_PATH_LENGTH = MAX_WORKSPACE_LOCATOR_LENGTH
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

export function isValidWorkspaceLocatorInput(value: unknown): value is WorkspaceId {
  return toSafeWorkspaceLocator(value) !== null
}

export function toSafeWorkspaceLocator(value: unknown): WorkspaceId | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IPC_PATH_LENGTH || value.includes('\0')) {
    return null
  }
  const platform = currentPlatform()
  const parsed = parseWorkspaceLocator(value, platform)
  return parsed ? formatWorkspaceLocator(parsed, platform) : null
}

export function toSafeWorkspaceSessionEntry(value: unknown): WorkspaceSessionEntry | null {
  const entry = normalizeWorkspaceSessionEntry(value)
  const id = toSafeWorkspaceLocator(entry?.id)
  if (!id) return null
  return { id }
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
