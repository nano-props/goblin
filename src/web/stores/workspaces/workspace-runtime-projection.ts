import type { WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { acceptRemoteWorkspaceRuntimeProjection } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { acceptWorkspaceProbeProjection } from '#/web/stores/workspaces/workspace-probe-projection.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'

/**
 * Project one authoritative runtime snapshot as one lifecycle boundary.
 *
 * Runtime lifecycle and workspace capability are two projections of the same
 * runtime epoch. Callers must consume them together so a new epoch cannot be
 * left in `probing` after its authoritative probe has already settled. Remote
 * entries use the existing single-entry atomic projection; local entries only
 * need the capability projection.
 */
export function acceptWorkspaceRuntimeSnapshot(
  set: WorkspacesSet,
  get: WorkspacesGet,
  snapshot: WorkspaceRuntimesSnapshot,
): void {
  for (const entry of snapshot.runtimes) {
    if (acceptRemoteWorkspaceRuntimeProjection(set, get, entry)) continue
    acceptWorkspaceProbeProjection(set, get, entry)
  }
}
