import { tildifyPath } from '#/shared/paths.ts'
import type { RemoteRepoRef, RemoteRepoTarget, WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'

export type RemoteRepoRefLocatorInput = Pick<RemoteRepoRef, 'alias' | 'remotePath'>
export type RemoteRepoTargetLocatorInput = Pick<RemoteRepoTarget, 'host' | 'user' | 'remotePath'>
export type RemoteWorktreeLocatorInput = Pick<RemoteRepoTarget, 'host' | 'user'>

export const MAX_REPO_LOCATOR_LENGTH = 4096

export function toSafeCanonicalRepoLocator(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REPO_LOCATOR_LENGTH ||
    value.includes('\0')
  ) {
    return null
  }
  const platform = typeof process !== 'undefined' && process.platform === 'win32' ? 'win32' : 'posix'
  return parseWorkspaceLocator(value, platform) ? value : null
}

export function formatRepoLocator(
  repoId: string,
  home: string,
  remoteTarget?: RemoteRepoTargetLocatorInput | null,
): string {
  return remoteTarget ? formatRemoteRepoTargetLocator(remoteTarget) : formatLocalRepoLocator(repoId, home)
}

export function formatWorkspaceSessionEntryLocator(entry: WorkspaceSessionEntry, home: string): string {
  if (entry.kind === 'remote') return formatRemoteRepoRefLocator(entry.ref)
  const platform = /^[A-Za-z]:\\/.test(home) ? 'win32' : 'posix'
  const locator = parseWorkspaceLocator(entry.id, platform)
  return locator?.transport === 'file' ? formatLocalRepoLocator(locator.path, home) : entry.id
}

export function formatLocalRepoLocator(repoId: string, home: string): string {
  return tildifyPath(repoId, home)
}

export function formatRemoteRepoRefLocator(ref: RemoteRepoRefLocatorInput): string {
  return `${ref.alias}:${ref.remotePath}`
}

export function formatRemoteRepoTargetLocator(target: RemoteRepoTargetLocatorInput): string {
  return `${target.user}@${target.host}:${target.remotePath}`
}

export function formatRemoteWorktreeLocator(target: RemoteWorktreeLocatorInput, path: string): string {
  return `${target.user}@${target.host}:${path}`
}
