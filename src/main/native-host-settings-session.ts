import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { applyNativeHostRecentReposMenuState } from '#/main/native-host-settings-effects.ts'

function syncRecentDocumentOnAdd(repo: RepoSessionEntry, addRecentDocument: (path: string) => void): void {
  if (repo.kind !== 'local') return
  addRecentDocument(repo.id)
}

export function applyNativeHostRecentReposProjection(
  recentRepos: RepoSessionEntry[],
  options: {
    addRecentDocument: (path: string) => void
    addedRepo?: RepoSessionEntry
  },
): void {
  if (options.addedRepo) syncRecentDocumentOnAdd(options.addedRepo, options.addRecentDocument)
  applyNativeHostRecentReposMenuState(recentRepos)
}
