import { tildifyPath } from '#/shared/paths.ts'
import type { RemoteWorkspaceTarget, WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceTargetLocatorInput = Pick<RemoteWorkspaceTarget, 'host' | 'user' | 'remotePath'>
export type RemoteWorktreeLocatorInput = Pick<RemoteWorkspaceTarget, 'host' | 'user'>

export function formatWorkspaceDisplayLocation(
  workspaceId: string,
  home: string,
  remoteTarget?: RemoteWorkspaceTargetLocatorInput | null,
): string {
  const locator = parseCanonicalWorkspaceLocator(workspaceId)
  if (locator?.transport === 'file') return formatLocalWorkspaceLocation(locator.path, home)
  if (locator?.transport === 'ssh') {
    return remoteTarget?.remotePath === locator.path
      ? formatRemoteWorkspaceTargetLocator(remoteTarget)
      : `${locator.profile}:${locator.path}`
  }
  return workspaceId
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
