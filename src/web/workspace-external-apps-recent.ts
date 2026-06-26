export const WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY = 'goblin.workspace-external-app.recent'

export function workspaceExternalAppRecentScope(repoId: string, worktreePath?: string | null): string {
  return worktreePath ? `${repoId}:${worktreePath}` : repoId
}

function recentStorageKey(scope?: string): string {
  return scope ? `${WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY}:${scope}` : WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY
}

export function readRecentWorkspaceExternalAppId(scope?: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(recentStorageKey(scope))
  } catch {
    return null
  }
}

export function writeRecentWorkspaceExternalAppId(itemId: string, scope?: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(recentStorageKey(scope), itemId)
  } catch {
    // Best-effort UI preference. Private browsing / quota failures should
    // not block opening the selected external app.
  }
}
