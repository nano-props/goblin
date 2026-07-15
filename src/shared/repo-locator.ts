import { tildifyPath } from '#/shared/paths.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { RemoteRepoRef, RemoteRepoTarget, RepoSessionEntry } from '#/shared/remote-repo.ts'

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
  if (isRemoteRepoId(value)) return value
  return isAbsoluteLocalRepoPath(value) ? value : null
}

function isAbsoluteLocalRepoPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

export function formatRepoLocator(
  repoId: string,
  home: string,
  remoteTarget?: RemoteRepoTargetLocatorInput | null,
): string {
  return remoteTarget ? formatRemoteRepoTargetLocator(remoteTarget) : formatLocalRepoLocator(repoId, home)
}

export function formatRepoSessionEntryLocator(entry: RepoSessionEntry, home: string): string {
  return entry.kind === 'local' ? formatLocalRepoLocator(entry.id, home) : formatRemoteRepoRefLocator(entry.ref)
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
