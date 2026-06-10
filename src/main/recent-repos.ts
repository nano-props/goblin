import { app } from 'electron'
import { buildAppMenu } from '#/main/menu.ts'
import { applyMenuRuntimeState } from '#/main/menu-state.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

/**
 * Single authority for syncing the recent-repos list into every macOS
 * surface that displays it:
 *   - File → Open Recent        (via menu-state → buildAppMenu)
 *   - Dock → Recent Documents   (via app.addRecentDocument)
 *
 * Callers should always go through this function instead of touching
 * menu-state or app.addRecentDocument directly.
 */
export function rebuildMenuWithRecentRepos(recentRepos: RepoSessionEntry[]): void {
  applyMenuRuntimeState({ recentRepos })
  buildAppMenu()
  syncDockRecentDocuments(recentRepos)
}

function syncDockRecentDocuments(recentRepos: RepoSessionEntry[]): void {
  app.clearRecentDocuments()
  for (const repo of recentRepos) {
    if (repo.kind === 'local') {
      app.addRecentDocument(repo.id)
    }
  }
}
