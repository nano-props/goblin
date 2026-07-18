import {
  isRemoteRepoId,
  remoteRepoConnectionTarget,
  remoteRepoRefFromTarget,
  remoteWorkspaceSessionEntry,
  type WorkspaceSessionEntry,
} from '#/shared/remote-repo.ts'
import type { WorkspaceAdmissionState } from '#/web/stores/workspaces/types.ts'

/** Minimal shape this helper needs from a `WorkspaceState`. Defined
 *  locally so the persistence / session layer doesn't have to
 *  depend on the full store types. */
interface OpenWorkspaceRepoLike {
  id: string
  session?: {
    entry: WorkspaceSessionEntry | null
  }
  admission: WorkspaceAdmissionState
}

export function persistedOpenWorkspaceEntries(
  workspaceOrder: string[],
  workspaces: Record<string, OpenWorkspaceRepoLike | undefined>,
): WorkspaceSessionEntry[] {
  return workspaceOrder.flatMap<WorkspaceSessionEntry>((id) => {
    const repo = workspaces[id]
    if (!repo) return []
    if (repo.session?.entry) return [repo.session.entry]
    if (!isRemoteRepoId(repo.id)) return [{ kind: 'local', id: repo.id }]
    // For remote workspaces, reconstruct the session entry from the
    // last-known target (lifecycle.target). A failed lifecycle
    // may or may not have a retained target; without one we
    // can't reconstruct a session entry, so the repo is dropped
    // from the recent-workspace list. This is the same
    // intentional trade-off: a placeholder with no target is just a
    // connecting spinner, not a repo the user explicitly opened.
    if (repo.admission.kind !== 'remote') return []
    const target = remoteRepoConnectionTarget(repo.admission.lifecycle)
    if (!target) return []
    return [remoteWorkspaceSessionEntry(remoteRepoRefFromTarget(target))]
  })
}

export function nextRestoredRepoIdAfterWorkspaceClose(
  workspaceOrder: string[],
  restoredWorkspaceId: string | null,
  closedId: string,
): string | null {
  if (restoredWorkspaceId !== closedId) return restoredWorkspaceId
  const idx = workspaceOrder.indexOf(closedId)
  if (idx === -1) return null
  return workspaceOrder[idx + 1] ?? workspaceOrder[idx - 1] ?? null
}

export function restoredWorkspaceIdAfterWorkspaceHydration(
  currentRestoredRepoId: string | null,
  workspaces: Record<string, unknown>,
  workspaceOrder: string[],
  preferredActiveRepoId: string | null,
  managedRestoredRepoId: string | null,
): string | null {
  if (currentRestoredRepoId && currentRestoredRepoId !== managedRestoredRepoId && workspaces[currentRestoredRepoId]) {
    return currentRestoredRepoId
  }
  if (preferredActiveRepoId && workspaces[preferredActiveRepoId]) return preferredActiveRepoId
  if (preferredActiveRepoId) return null
  return workspaceOrder[0] ?? null
}
