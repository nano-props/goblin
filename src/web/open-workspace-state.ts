import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

/** Minimal shape this helper needs from a `WorkspaceState`. Defined
 *  locally so the persistence / session layer doesn't have to
 *  depend on the full store types. */
interface OpenWorkspaceLike {
  id: WorkspaceId
  session?: {
    entry: WorkspaceSessionEntry | null
  }
}

export function persistedOpenWorkspaceEntries(
  workspaceOrder: WorkspaceId[],
  workspaces: Record<string, OpenWorkspaceLike | undefined>,
): WorkspaceSessionEntry[] {
  return workspaceOrder.flatMap<WorkspaceSessionEntry>((id) => {
    const workspace = workspaces[id]
    if (!workspace) return []
    return [workspace.session?.entry ?? { id: workspace.id }]
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
