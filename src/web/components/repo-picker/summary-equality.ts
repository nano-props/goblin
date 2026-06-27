import type { RepoPickerRepo } from '#/web/components/repo-picker/types.ts'
import {
  isRemoteRepoConnectionTerminal,
  type RemoteRepoConnectionLifecycle,
  type RemoteRepoTarget,
} from '#/shared/remote-repo.ts'

/**
 * Structural equality for the lifecycle union as it appears on a
 * `RepoPickerRepo`. The `connecting` variant has no fields, while
 * terminal variants include the rendered remote locator.
 */
function remoteTargetEqual(a: RemoteRepoTarget, b: RemoteRepoTarget): boolean {
  return (
    a.id === b.id &&
    a.alias === b.alias &&
    a.host === b.host &&
    a.user === b.user &&
    a.port === b.port &&
    a.remotePath === b.remotePath &&
    a.displayName === b.displayName
  )
}

function lifecycleEqual(a: RemoteRepoConnectionLifecycle | null, b: RemoteRepoConnectionLifecycle | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'connecting' && b.kind === 'connecting') return true
  if (a.kind === 'ready' && b.kind === 'ready') {
    return remoteTargetEqual(a.target, b.target)
  }
  if (a.kind === 'failed' && b.kind === 'failed') {
    if (a.reason !== b.reason) return false
    if (a.target && !b.target) return false
    if (!a.target && b.target) return false
    if (a.target && b.target) {
      return remoteTargetEqual(a.target, b.target)
    }
    return true
  }
  return !isRemoteRepoConnectionTerminal(a) && !isRemoteRepoConnectionTerminal(b)
}

export function repoPickerReposEqual(a: RepoPickerRepo[], b: RepoPickerRepo[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.name !== y.name || x.lastSyncedAt !== y.lastSyncedAt) return false
    if (!lifecycleEqual(x.lifecycle, y.lifecycle)) return false
    if (x.remoteDetails.length !== y.remoteDetails.length) return false
    for (let j = 0; j < x.remoteDetails.length; j++) {
      const xr = x.remoteDetails[j]!
      const yr = y.remoteDetails[j]!
      if (xr.name !== yr.name || xr.fetchUrl !== yr.fetchUrl || xr.pushUrl !== yr.pushUrl) return false
    }
  }
  return true
}
