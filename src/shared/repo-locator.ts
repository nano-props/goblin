import { tildifyPath } from '#/shared/paths.ts'
import type { RemoteWorkspaceRef, RemoteWorkspaceTarget, WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import {
  canonicalWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  type WorkspaceId,
} from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceRefLocatorInput = Pick<RemoteWorkspaceRef, 'alias' | 'remotePath'>
export type RemoteWorkspaceTargetLocatorInput = Pick<RemoteWorkspaceTarget, 'host' | 'user' | 'remotePath'>
export type RemoteWorktreeLocatorInput = Pick<RemoteWorkspaceTarget, 'host' | 'user'>

export const MAX_REPO_LOCATOR_LENGTH = 4096

export function toSafeCanonicalRepoLocator(value: unknown): WorkspaceId | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REPO_LOCATOR_LENGTH ||
    value.includes('\0')
  ) {
    return null
  }
  return canonicalWorkspaceLocator(value)
}

export function formatWorkspaceDisplayLocation(
  workspaceId: string,
  home: string,
  remoteTarget?: RemoteWorkspaceTargetLocatorInput | null,
): string {
  const locator = parseCanonicalWorkspaceLocator(workspaceId)
  if (locator?.transport === 'file') return formatLocalRepoLocator(locator.path, home)
  if (locator?.transport === 'ssh') {
    return remoteTarget?.remotePath === locator.path
      ? formatRemoteWorkspaceTargetLocator(remoteTarget)
      : `${locator.profile}:${locator.path}`
  }
  return workspaceId
}

export function formatWorkspaceSessionEntryLocator(entry: WorkspaceSessionEntry, home: string): string {
  if (entry.kind === 'remote') return formatRemoteWorkspaceRefLocator(entry.ref)
  return formatWorkspaceDisplayLocation(entry.id, home)
}

export function formatLocalRepoLocator(repoId: string, home: string): string {
  return tildifyPath(repoId, home)
}

export function formatRemoteWorkspaceRefLocator(ref: RemoteWorkspaceRefLocatorInput): string {
  return `${ref.alias}:${ref.remotePath}`
}

export function formatRemoteWorkspaceTargetLocator(target: RemoteWorkspaceTargetLocatorInput): string {
  return `${target.user}@${target.host}:${target.remotePath}`
}

export function formatRemoteWorktreeLocator(target: RemoteWorktreeLocatorInput, path: string): string {
  return `${target.user}@${target.host}:${path}`
}
