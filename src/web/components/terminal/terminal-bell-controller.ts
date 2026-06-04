import { lastPathSegment } from '#/web/lib/paths.ts'
import { terminalBridge } from '#/web/terminal.ts'
import type { TerminalBellEvent, TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { getRuntimeFetchSettings } from '#/web/runtime-settings-hooks.ts'
const BELL_NOTIFICATION_DEBOUNCE_MS = 5000

export interface TerminalBellController {
  hasBell: (key: string) => boolean
  clear: (key: string) => boolean
  remove: (key: string) => void
  reset: () => void
  handleBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void
}

export function createTerminalBellController(
  notify: (key?: string) => void,
  onBadgeChange: (count: number) => void,
): TerminalBellController {
  const unreadKeys = new Set<string>()
  const lastNotificationAt = new Map<string, number>()

  function notifyAndBadge(key?: string) {
    notify(key)
    onBadgeChange(unreadKeys.size)
  }

  return {
    hasBell(key) {
      return unreadKeys.has(key)
    },
    clear(key) {
      const changed = unreadKeys.delete(key)
      if (changed) notifyAndBadge(key)
      return changed
    },
    remove(key) {
      const had = unreadKeys.has(key)
      unreadKeys.delete(key)
      lastNotificationAt.delete(key)
      if (had) notifyAndBadge(key)
    },
    reset() {
      const had = unreadKeys.size > 0
      unreadKeys.clear()
      lastNotificationAt.clear()
      if (had) notifyAndBadge()
    },
    handleBell(descriptor, event) {
      const windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true
      if (event.visible && windowFocused) return
      const changed = !unreadKeys.has(descriptor.key)
      unreadKeys.add(descriptor.key)
      if (changed) notifyAndBadge(descriptor.key)
      if (!getRuntimeFetchSettings().terminalNotificationsEnabled) return
      const now = Date.now()
      const lastNotifiedAt = lastNotificationAt.get(descriptor.key) ?? 0
      if (now - lastNotifiedAt < BELL_NOTIFICATION_DEBOUNCE_MS) return
      lastNotificationAt.set(descriptor.key, now)
      const repoName = lastPathSegment(descriptor.repoRoot)
      const bodyParts = [descriptor.branch]
      const canonicalTitle = typeof event.canonicalTitle === 'string' ? event.canonicalTitle.trim() : ''
      if (canonicalTitle) bodyParts.push(canonicalTitle)
      else if (event.processName) bodyParts.push(event.processName)
      void terminalBridge
        .notifyBell({ title: repoName, body: bodyParts.join('\n'), key: descriptor.key, repoRoot: descriptor.repoRoot })
        .catch(() => {})
    },
  }
}
