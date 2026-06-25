export const WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY = 'goblin.workspace-external-app.recent'

export function readRecentWorkspaceExternalAppId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeRecentWorkspaceExternalAppId(itemId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WORKSPACE_EXTERNAL_APP_RECENT_STORAGE_KEY, itemId)
  } catch {
    // Best-effort UI preference. Private browsing / quota failures should
    // not block opening the selected external app.
  }
}
