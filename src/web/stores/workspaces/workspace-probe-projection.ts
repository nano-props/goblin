import type { WorkspaceRuntimeEntry, WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'

export function acceptWorkspaceProbeProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  entry: Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId' | 'workspaceProbe'>,
): boolean {
  const current = get().workspaces[entry.workspaceId]
  if (!current || current.workspaceRuntimeId !== entry.workspaceRuntimeId) return false
  let accepted = false
  updateIfFresh(set, entry.workspaceId, entry.workspaceRuntimeId, (repo) => {
    repo.workspaceProbe = entry.workspaceProbe
    accepted = true
  })
  return accepted
}

export function acceptWorkspaceProbeSnapshot(set: WorkspacesSet, get: WorkspacesGet, snapshot: WorkspaceRuntimesSnapshot): void {
  for (const entry of snapshot.runtimes) acceptWorkspaceProbeProjection(set, get, entry)
}
