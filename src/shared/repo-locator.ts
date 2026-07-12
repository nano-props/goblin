import { tildifyPath } from '#/shared/paths.ts'
import type { RemoteRepoRef, RemoteRepoTarget, RepoSessionEntry } from '#/shared/remote-repo.ts'

export type RemoteRepoRefLocatorInput = Pick<RemoteRepoRef, 'alias' | 'remotePath'>
export type RemoteRepoTargetLocatorInput = Pick<RemoteRepoTarget, 'host' | 'user' | 'remotePath'>
export type RemoteWorktreeLocatorInput = Pick<RemoteRepoTarget, 'host' | 'user'>

/**
 * User-facing repository locator.
 *
 * Local repos render as tildified paths. Concrete remote targets render
 * with connection identity, while persisted remote refs render with the
 * SSH alias because they do not carry host/user fields.
 */
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
