import path from 'node:path'
import {
  formatWorkspaceLocator,
  MAX_WORKSPACE_LOCATOR_LENGTH,
  parseWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'

export const MAX_IPC_PATH_LENGTH = MAX_WORKSPACE_LOCATOR_LENGTH

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

function currentPlatform(): WorkspaceLocatorPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}
