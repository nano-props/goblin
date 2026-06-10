import { app } from 'electron'
import { applyMenuRuntimeState } from '#/main/menu-state.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

/**
 * Single authority for syncing the recent-repos list into every macOS
 * surface that displays it:
 *   - File → Open Recent        (via menu-state)
 *   - Dock → Recent Documents   (via app.addRecentDocument)
 *
 * Callers should always go through this function instead of touching
 * menu-state or app.addRecentDocument directly.
 *
 * Note: this does NOT rebuild the app menu. Callers must arrange
 * buildAppMenu() themselves so that language / theme / layout state
 * is settled before the menu is rendered.
 */
export function syncRecentRepos(recentRepos: RepoSessionEntry[]): void {
  applyMenuRuntimeState({ recentRepos })
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
