import {
  isRemoteWorkspaceId,
  remoteWorkspaceConnectionTarget,
  remoteWorkspaceRefFromTarget,
  remoteWorkspaceSessionEntry,
  type WorkspaceSessionEntry,
} from '#/shared/remote-workspace.ts'
import type { WorkspaceAdmissionState } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

/** Minimal shape this helper needs from a `WorkspaceState`. Defined
 *  locally so the persistence / session layer doesn't have to
 *  depend on the full store types. */
interface OpenWorkspaceLike {
  id: WorkspaceId
  session?: {
    entry: WorkspaceSessionEntry | null
  }
  admission: WorkspaceAdmissionState
}

export function persistedOpenWorkspaceEntries(
  workspaceOrder: WorkspaceId[],
  workspaces: Record<string, OpenWorkspaceLike | undefined>,
): WorkspaceSessionEntry[] {
  return workspaceOrder.flatMap<WorkspaceSessionEntry>((id) => {
    const workspace = workspaces[id]
    if (!workspace) return []
    if (workspace.session?.entry) return [workspace.session.entry]
    if (!isRemoteWorkspaceId(workspace.id)) return [{ kind: 'local', id: workspace.id }]
    // For remote workspaces, reconstruct the session entry from the
    // last-known target (lifecycle.target). A failed lifecycle
    // may or may not have a retained target; without one we
    // can't reconstruct a session entry, so the workspace is dropped
    // from the recent-workspace list. This is the same
    // intentional trade-off: a placeholder with no target is just a
    // connecting spinner, not a workspace the user explicitly opened.
    if (workspace.admission.kind !== 'remote') return []
    const target = remoteWorkspaceConnectionTarget(workspace.admission.lifecycle)
    if (!target) return []
    return [remoteWorkspaceSessionEntry(remoteWorkspaceRefFromTarget(target))]
  })
}

export function nextRestoredWorkspaceIdAfterWorkspaceClose(
  workspaceOrder: WorkspaceId[],
  restoredWorkspaceId: WorkspaceId | null,
  closedId: WorkspaceId,
): WorkspaceId | null {
  if (restoredWorkspaceId !== closedId) return restoredWorkspaceId
  const idx = workspaceOrder.indexOf(closedId)
  if (idx === -1) return null
  return workspaceOrder[idx + 1] ?? workspaceOrder[idx - 1] ?? null
}

export function restoredWorkspaceIdAfterWorkspaceHydration(
  currentRestoredWorkspaceId: WorkspaceId | null,
  workspaces: Record<string, unknown>,
  workspaceOrder: WorkspaceId[],
  preferredActiveWorkspaceId: WorkspaceId | null,
  managedRestoredWorkspaceId: WorkspaceId | null,
): WorkspaceId | null {
  if (currentRestoredWorkspaceId && currentRestoredWorkspaceId !== managedRestoredWorkspaceId && workspaces[currentRestoredWorkspaceId]) {
    return currentRestoredWorkspaceId
  }
  if (preferredActiveWorkspaceId && workspaces[preferredActiveWorkspaceId]) return preferredActiveWorkspaceId
  if (preferredActiveWorkspaceId) return null
  return workspaceOrder[0] ?? null
}
