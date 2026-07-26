import { tildifyPath } from '#/shared/paths.ts'
import type { RemoteWorkspaceTarget, WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceTargetLocatorInput = Pick<RemoteWorkspaceTarget, 'host' | 'user' | 'remotePath'>
export type RemoteWorktreeLocatorInput = Pick<RemoteWorkspaceTarget, 'host' | 'user'>

/** User-facing directory name shared by every workspace transport. */
export function workspaceNameFromLocator(workspaceId: WorkspaceId): string {
  const locator = parseCanonicalWorkspaceLocator(workspaceId)
  if (!locator) throw new TypeError('Workspace name requires a canonical workspace ID')
  const workspacePath = locator.path
  if (
    workspacePath === '/' ||
    (locator.transport === 'file' && locator.platform === 'win32' && workspacePath.endsWith('\\'))
  ) {
    return workspacePath
  }
  const separator = locator.transport === 'file' && locator.platform === 'win32' ? '\\' : '/'
  const separatorIndex = workspacePath.lastIndexOf(separator)
  if (separatorIndex < 0) throw new Error('Canonical workspace path must be absolute')
  return workspacePath.slice(separatorIndex + 1)
}

export function formatWorkspaceDisplayLocation(
  workspaceId: WorkspaceId,
  home: string,
  remoteTarget?: RemoteWorkspaceTargetLocatorInput | null,
): string {
  const locator = parseCanonicalWorkspaceLocator(workspaceId)
  if (!locator) throw new TypeError('Workspace display location requires a canonical workspace ID')
  if (locator.transport === 'file') return formatLocalWorkspaceLocation(locator.path, home)
  if (locator.transport === 'ssh') {
    return remoteTarget?.remotePath === locator.path
      ? formatRemoteWorkspaceTargetLocator(remoteTarget)
      : `${locator.profile}:${locator.path}`
  }
  throw new Error('Canonical workspace locator has an unsupported transport')
}

export function formatWorkspaceSessionEntryLocator(entry: WorkspaceSessionEntry, home: string): string {
  return formatWorkspaceDisplayLocation(entry.id, home)
}

export function formatLocalWorkspaceLocation(path: string, home: string): string {
  return tildifyPath(path, home)
}

export function formatRemoteWorkspaceTargetLocator(target: RemoteWorkspaceTargetLocatorInput): string {
  return `${target.user}@${target.host}:${target.remotePath}`
}

export function formatRemoteWorktreeLocator(target: RemoteWorktreeLocatorInput, path: string): string {
  return `${target.user}@${target.host}:${path}`
}
