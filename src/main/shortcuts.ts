import { globalShortcut } from 'electron'
import { activateMainWindow } from '#/main/window.ts'
import { shortcutsNodeLog } from '#/node/logger.ts'
import { DEFAULT_GLOBAL_SHORTCUT, normalizeGlobalShortcut } from '#/shared/accelerator.ts'

let registeredShortcut: string | null = null

export function syncGlobalShortcuts(disabled: boolean, accelerator = DEFAULT_GLOBAL_SHORTCUT): boolean {
  unregisterAppShortcuts()
  if (disabled) return false
  const normalized = normalizeGlobalShortcut(accelerator)
  try {
    const registered = globalShortcut.register(normalized, () => {
      void activateMainWindow()
    })
    registeredShortcut = registered ? normalized : null
    return registered
  } catch (err) {
    shortcutsNodeLog.warn({ err }, 'global shortcut registration failed')
    registeredShortcut = null
    return false
  }
}

export function replaceGlobalShortcut(disabled: boolean, previous: string, next: string): boolean {
  const registered = syncGlobalShortcuts(disabled, next)
  if (!registered && !disabled) syncGlobalShortcuts(false, previous)
  return registered
}

export function isGlobalShortcutRegistered(): boolean {
  return registeredShortcut !== null && globalShortcut.isRegistered(registeredShortcut)
}

export function unregisterAppShortcuts(): void {
  if (!registeredShortcut) return
  globalShortcut.unregister(registeredShortcut)
  registeredShortcut = null
}
