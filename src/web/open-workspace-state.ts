import {
  isRemoteRepoId,
  remoteRepoConnectionTarget,
  remoteRepoRefFromTarget,
  remoteRepoSessionEntry,
  type RemoteRepoConnectionLifecycle,
  type RepoSessionEntry,
} from '#/shared/remote-repo.ts'

/** Minimal shape this helper needs from a `RepoState`. Defined
 *  locally so the persistence / session layer doesn't have to
 *  depend on the full store types. */
interface OpenWorkspaceRepoLike {
  id: string
  remote: {
    lifecycle: RemoteRepoConnectionLifecycle | null
  }
}

export function persistedOpenWorkspaceEntries(
  order: string[],
  repos: Record<string, OpenWorkspaceRepoLike | undefined>,
): RepoSessionEntry[] {
  return order.flatMap<RepoSessionEntry>((id) => {
    const repo = repos[id]
    if (!repo) return []
    if (!isRemoteRepoId(repo.id)) return [{ kind: 'local', id: repo.id }]
    // For remote repos, reconstruct the session entry from the
    // last-known target (lifecycle.target). A failed lifecycle
    // may or may not have a retained target; without one we
    // can't reconstruct a session entry, so the repo is dropped
    // from the recent-workspace list. This is the same
    // intentional trade-off: a placeholder with no target is just a
    // connecting spinner, not a repo the user explicitly opened.
    const target = remoteRepoConnectionTarget(repo.remote.lifecycle)
    if (!target) return []
    return [remoteRepoSessionEntry(remoteRepoRefFromTarget(target))]
  })
}

export function nextActiveRepoIdAfterWorkspaceClose(
  order: string[],
  activeId: string | null,
  closedId: string,
): string | null {
  if (activeId !== closedId) return activeId
  const idx = order.indexOf(closedId)
  if (idx === -1) return null
  return order[idx + 1] ?? order[idx - 1] ?? null
}

export function activeRepoIdAfterWorkspaceHydration(
  currentActiveId: string | null,
  repos: Record<string, unknown>,
  order: string[],
  preferredActiveRepoId: string | null,
  managedActiveId: string | null,
): string | null {
  if (currentActiveId && currentActiveId !== managedActiveId && repos[currentActiveId]) return currentActiveId
  if (preferredActiveRepoId && repos[preferredActiveRepoId]) return preferredActiveRepoId
  return order[0] ?? null
}
