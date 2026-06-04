import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { applyRecentReposEffects } from '#/main/settings-native-effects.ts'

function syncRecentDocumentOnAdd(repo: RepoSessionEntry, addRecentDocument: (path: string) => void): void {
  if (repo.kind !== 'local') return
  addRecentDocument(repo.id)
}

export function applyRecentReposProjection(
  recentRepos: RepoSessionEntry[],
  options: {
    addRecentDocument: (path: string) => void
    addedRepo?: RepoSessionEntry
  },
): void {
  if (options.addedRepo) syncRecentDocumentOnAdd(options.addedRepo, options.addRecentDocument)
  applyRecentReposEffects(recentRepos)
}
