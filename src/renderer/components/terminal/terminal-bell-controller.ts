import { translate } from '#/renderer/stores/i18n.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { terminalBridge } from '#/renderer/terminal.ts'
import type { TerminalBellEvent, TerminalDescriptor } from '#/renderer/components/terminal/types.ts'

const BELL_NOTIFICATION_DEBOUNCE_MS = 5000

export interface TerminalBellController {
  hasBell: (key: string) => boolean
  clear: (key: string) => boolean
  remove: (key: string) => void
  reset: () => void
  handleBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void
}

export function createTerminalBellController(notify: () => void): TerminalBellController {
  const unreadKeys = new Set<string>()
  const lastNotificationAt = new Map<string, number>()

  return {
    hasBell(key) {
      return unreadKeys.has(key)
    },
    clear(key) {
      const changed = unreadKeys.delete(key)
      if (changed) notify()
      return changed
    },
    remove(key) {
      unreadKeys.delete(key)
      lastNotificationAt.delete(key)
    },
    reset() {
      unreadKeys.clear()
      lastNotificationAt.clear()
    },
    handleBell(descriptor, event) {
      const windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true
      if (event.visible && windowFocused) return
      const changed = !unreadKeys.has(descriptor.key)
      unreadKeys.add(descriptor.key)
      if (changed) notify()
      if (!useSettingsStore.getState().terminalNotificationsEnabled) return
      const now = Date.now()
      const lastNotifiedAt = lastNotificationAt.get(descriptor.key) ?? 0
      if (now - lastNotifiedAt < BELL_NOTIFICATION_DEBOUNCE_MS) return
      lastNotificationAt.set(descriptor.key, now)
      const terminalTitle = translate('terminal.index-title', { index: descriptor.index })
      void terminalBridge
        .notifyBell({
          title: translate('terminal.bell-notification-title'),
          body: translate('terminal.bell-notification-body', {
            terminalTitle,
            processName: event.processName,
            branch: descriptor.branch,
          }),
        })
        .catch(() => {})
    },
  }
}
