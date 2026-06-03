import { remoteRepoRefFromTarget, remoteRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
interface OpenWorkspaceRepoLike {
  id: string
  remote: {
    target?: RemoteRepoTarget
  }
}

export function persistedOpenWorkspaceEntries(
  order: string[],
  repos: Record<string, OpenWorkspaceRepoLike | undefined>,
): RepoSessionEntry[] {
  return order.flatMap<RepoSessionEntry>((id) => {
    const repo = repos[id]
    if (!repo) return []
    return repo.remote.target
      ? [remoteRepoSessionEntry(remoteRepoRefFromTarget(repo.remote.target))]
      : [{ kind: 'local', id: repo.id }]
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
