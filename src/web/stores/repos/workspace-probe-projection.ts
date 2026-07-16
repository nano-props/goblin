import type { RepoRuntimeEntry, RepoRuntimesSnapshot } from '#/shared/api-types.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

export function acceptWorkspaceProbeProjection(
  set: ReposSet,
  get: ReposGet,
  entry: Pick<RepoRuntimeEntry, 'repoRoot' | 'repoRuntimeId' | 'workspaceProbe'>,
): boolean {
  const current = get().repos[entry.repoRoot]
  if (!current || current.repoRuntimeId !== entry.repoRuntimeId) return false
  let accepted = false
  updateIfFresh(set, entry.repoRoot, entry.repoRuntimeId, (repo) => {
    repo.workspaceProbe = entry.workspaceProbe
    accepted = true
  })
  return accepted
}

export function acceptWorkspaceProbeSnapshot(set: ReposSet, get: ReposGet, snapshot: RepoRuntimesSnapshot): void {
  for (const entry of snapshot.runtimes) acceptWorkspaceProbeProjection(set, get, entry)
}
