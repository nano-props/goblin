import type { WorkspaceRuntimeEntry, WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

export function acceptWorkspaceProbeProjection(
  set: ReposSet,
  get: ReposGet,
  entry: Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId' | 'workspaceProbe'>,
): boolean {
  const current = get().repos[entry.workspaceId]
  if (!current || current.workspaceRuntimeId !== entry.workspaceRuntimeId) return false
  let accepted = false
  updateIfFresh(set, entry.workspaceId, entry.workspaceRuntimeId, (repo) => {
    repo.workspaceProbe = entry.workspaceProbe
    accepted = true
  })
  return accepted
}

export function acceptWorkspaceProbeSnapshot(set: ReposSet, get: ReposGet, snapshot: WorkspaceRuntimesSnapshot): void {
  for (const entry of snapshot.runtimes) acceptWorkspaceProbeProjection(set, get, entry)
}
