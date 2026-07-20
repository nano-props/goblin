import { app } from 'electron'
import { applyMenuRuntimeState } from '#/main/menu-state.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'

/**
 * Single authority for syncing the recent-workspaces list into every macOS
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
export function syncRecentWorkspaces(recentWorkspaces: WorkspaceSessionEntry[]): void {
  applyMenuRuntimeState({ recentWorkspaces })
  syncDockRecentDocuments(recentWorkspaces)
}

function syncDockRecentDocuments(recentWorkspaces: WorkspaceSessionEntry[]): void {
  app.clearRecentDocuments()
  for (const workspace of recentWorkspaces) {
    const locator = parseWorkspaceLocator(workspace.id, process.platform === 'win32' ? 'win32' : 'posix')
    if (locator?.transport === 'file') app.addRecentDocument(locator.path)
  }
}
