import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'

export function repoTabSummariesEqual(a: RepoTabSummary[], b: RepoTabSummary[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.name !== y.name || x.unavailable !== y.unavailable) return false
    if (
      x.remoteTarget?.id !== y.remoteTarget?.id ||
      x.remoteTarget?.alias !== y.remoteTarget?.alias ||
      x.remoteTarget?.host !== y.remoteTarget?.host ||
      x.remoteTarget?.user !== y.remoteTarget?.user ||
      x.remoteTarget?.port !== y.remoteTarget?.port ||
      x.remoteTarget?.remotePath !== y.remoteTarget?.remotePath ||
      x.remoteTarget?.displayName !== y.remoteTarget?.displayName
    ) {
      return false
    }
    if (x.remoteDetails.length !== y.remoteDetails.length) return false
    for (let j = 0; j < x.remoteDetails.length; j++) {
      const xr = x.remoteDetails[j]!
      const yr = y.remoteDetails[j]!
      if (xr.name !== yr.name || xr.fetchUrl !== yr.fetchUrl || xr.pushUrl !== yr.pushUrl) return false
    }
  }
  return true
}
