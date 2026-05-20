// Settings IPC. Exposes the subset of `settings.ts` that the renderer
// needs — theme pref + fetch interval + session state.
// Theme has its own `theme:*` channel pair (set + broadcast) defined in
// `ipc/theme.ts`; here we expose the simpler one-shot setters.
//
// Also wires the settings write-error broadcast so the renderer can
// show a toast instead of silently losing prefs when the disk is full /
// userData is read-only / iCloud holds the lock.

import { ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
import {
  addRecentRepo,
  clearRecentRepos,
  DEFAULT_SESSION_DETAIL_COLLAPSED,
  loadSettings,
  onSettingsWriteError,
  setFetchInterval,
  setSession,
  type SessionState,
} from '#/main/settings.ts'

export function wireSettingsIpc(): void {
  // Hydrate the renderer at boot. The full settings blob is small
  // enough that one IPC trip is cheaper than per-field handlers.
  ipcMain.handle('settings:get', async () => {
    const s = await loadSettings()
    return {
      theme: s.theme,
      fetchIntervalSec: s.fetchIntervalSec,
      session: s.session,
      recentRepos: s.recentRepos,
    }
  })

  ipcMain.handle('settings:set-fetch-interval', async (_e, sec: number) => {
    if (typeof sec !== 'number') return
    const clamped = await setFetchInterval(sec)
    broadcastFetchInterval(clamped)
  })

  ipcMain.handle('settings:save-session', async (_e, session: SessionState) => {
    if (!session || !Array.isArray(session.openRepos)) return
    const openRepos = session.openRepos.map(toSafeSessionPath).filter((p): p is string => p !== null)
    const activeRepo = toSafeSessionPath(session.activeRepo)
    const cleaned: SessionState = {
      openRepos,
      activeRepo: activeRepo && openRepos.includes(activeRepo) ? activeRepo : null,
      detailCollapsed:
        typeof session.detailCollapsed === 'boolean' ? session.detailCollapsed : DEFAULT_SESSION_DETAIL_COLLAPSED,
    }
    await setSession(cleaned)
  })

  ipcMain.handle('settings:add-recent-repo', async (_e, repoPath: string) => {
    if (typeof repoPath !== 'string') return []
    const recentRepos = await addRecentRepo(repoPath)
    await rebuildMenu()
    return recentRepos
  })

  ipcMain.handle('settings:clear-recent-repos', async () => {
    await clearRecentRepos()
    await rebuildMenu()
  })

  // Surface persistence failures to the renderer. Listener is
  // process-lifetime — we don't unsubscribe.
  onSettingsWriteError((err) => {
    const message = err instanceof Error ? err.message : String(err)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('app:settings-write-error', message)
    }
  })
}

function toSafeSessionPath(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0') || !path.isAbsolute(p)) return null
  return path.normalize(p)
}

function broadcastFetchInterval(sec: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:fetch-interval-changed', sec)
  }
}

async function rebuildMenu(): Promise<void> {
  const { buildAppMenu } = await import('#/main/menu.ts')
  buildAppMenu()
}
