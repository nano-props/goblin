import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import { isRemoteRepoLifecycleTerminal, type RemoteRepoLifecycle } from '#/shared/remote-repo.ts'

/**
 * Structural equality for the lifecycle union as it appears on a
 * `RepoTabSummary`. The `connecting` variant is the only
 * discriminating case here, since the only thing the tab UI cares
 * about is whether the lifecycle has converged.
 */
function lifecycleEqual(a: RemoteRepoLifecycle | null, b: RemoteRepoLifecycle | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'connecting' && b.kind === 'connecting') return true
  if (a.kind === 'ready' && b.kind === 'ready') {
    return (
      a.target.id === b.target.id &&
      a.target.alias === b.target.alias &&
      a.target.host === b.target.host &&
      a.target.user === b.target.user &&
      a.target.port === b.target.port &&
      a.target.remotePath === b.target.remotePath &&
      a.target.displayName === b.target.displayName
    )
  }
  if (a.kind === 'failed' && b.kind === 'failed') {
    if (a.reason !== b.reason) return false
    if (a.target && !b.target) return false
    if (!a.target && b.target) return false
    if (a.target && b.target) {
      return a.target.id === b.target.id && a.target.host === b.target.host
    }
    return true
  }
  return !isRemoteRepoLifecycleTerminal(a) && !isRemoteRepoLifecycleTerminal(b)
}

export function repoTabSummariesEqual(a: RepoTabSummary[], b: RepoTabSummary[]): boolean {
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
