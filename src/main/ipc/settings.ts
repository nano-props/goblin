// Settings IPC. Exposes the subset of `settings.ts` that the renderer
// needs — theme pref + fetch interval + shortcuts + session state.
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
  setGlobalShortcut,
  setSession,
  setShortcutsDisabled,
  type SessionState,
} from '#/main/settings.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut, syncGlobalShortcuts } from '#/main/shortcuts.ts'
import { parseGlobalShortcut } from '#/shared/accelerator.ts'

export function wireSettingsIpc(): void {
  // Hydrate the renderer at boot. The full settings blob is small
  // enough that one IPC trip is cheaper than per-field handlers.
  ipcMain.handle('settings:get', async () => {
    const s = await loadSettings()
    return {
      theme: s.theme,
      fetchIntervalSec: s.fetchIntervalSec,
      shortcutsDisabled: s.shortcutsDisabled,
      globalShortcut: s.globalShortcut,
      globalShortcutRegistered: isGlobalShortcutRegistered(),
      session: s.session,
      recentRepos: s.recentRepos,
    }
  })

  ipcMain.handle('settings:set-fetch-interval', async (_e, sec: number) => {
    if (typeof sec !== 'number') return
    const clamped = await setFetchInterval(sec)
    broadcastFetchInterval(clamped)
  })

  ipcMain.handle('settings:set-shortcuts-disabled', async (_e, disabled: boolean) => {
    if (typeof disabled !== 'boolean') return
    const saved = await setShortcutsDisabled(disabled)
    const s = await loadSettings()
    syncGlobalShortcuts(saved, s.globalShortcut)
    await rebuildMenu()
    broadcastShortcutsDisabled(saved)
    broadcastGlobalShortcut(s.globalShortcut)
  })

  ipcMain.handle('settings:set-global-shortcut', async (_e, accelerator: string) => {
    const parsed = parseGlobalShortcut(accelerator)
    const s = await loadSettings()
    if (!parsed) return globalShortcutPayload(s.globalShortcut)
    const registered = s.shortcutsDisabled || replaceGlobalShortcut(false, s.globalShortcut, parsed)
    if (!registered && !s.shortcutsDisabled) return globalShortcutPayload(s.globalShortcut)
    const saved = await setGlobalShortcut(parsed)
    broadcastGlobalShortcut(saved)
    return globalShortcutPayload(saved)
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

function broadcastShortcutsDisabled(disabled: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:shortcuts-disabled-changed', disabled)
  }
}

function broadcastGlobalShortcut(accelerator: string): void {
  const payload = globalShortcutPayload(accelerator)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:global-shortcut-changed', payload)
  }
}

function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}

async function rebuildMenu(): Promise<void> {
  const { buildAppMenu } = await import('#/main/menu.ts')
  buildAppMenu()
}
