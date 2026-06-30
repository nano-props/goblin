import { lastPathSegment } from '#/web/lib/paths.ts'
import { terminalBridge } from '#/web/terminal.ts'
import type { TerminalBellEvent, TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { getRuntimeFetchSettings } from '#/web/runtime-settings-fetch.ts'
const BELL_NOTIFICATION_THROTTLE_MS = 5000

export interface TerminalBellState {
  hasBell: (terminalKey: string) => boolean
  clear: (terminalKey: string) => boolean
  remove: (terminalKey: string) => void
  reset: () => void
  handleBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void
}

export function createTerminalBellState(
  notify: (terminalKey?: string) => void,
  onBadgeChange: (count: number) => void,
): TerminalBellState {
  const unreadTerminalKeys = new Set<string>()
  const lastSystemNotificationAtByTerminalKey = new Map<string, number>()

  onBadgeChange(unreadTerminalKeys.size)

  function notifyAndBadge(terminalKey?: string) {
    notify(terminalKey)
    onBadgeChange(unreadTerminalKeys.size)
  }

  return {
    hasBell(terminalKey) {
      return unreadTerminalKeys.has(terminalKey)
    },
    clear(terminalKey) {
      const changed = unreadTerminalKeys.delete(terminalKey)
      if (changed) notifyAndBadge(terminalKey)
      return changed
    },
    remove(terminalKey) {
      const had = unreadTerminalKeys.has(terminalKey)
      unreadTerminalKeys.delete(terminalKey)
      lastSystemNotificationAtByTerminalKey.delete(terminalKey)
      if (had) notifyAndBadge(terminalKey)
    },
    reset() {
      const had = unreadTerminalKeys.size > 0
      unreadTerminalKeys.clear()
      lastSystemNotificationAtByTerminalKey.clear()
      if (had) notifyAndBadge()
    },
    handleBell(descriptor, event) {
      const windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true
      if (event.visible && windowFocused) return
      const changed = !unreadTerminalKeys.has(descriptor.terminalKey)
      unreadTerminalKeys.add(descriptor.terminalKey)
      if (changed) notifyAndBadge(descriptor.terminalKey)
      if (!getRuntimeFetchSettings().terminalNotificationsEnabled) return
      const now = Date.now()
      const lastNotifiedAt = lastSystemNotificationAtByTerminalKey.get(descriptor.terminalKey) ?? 0
      // Leading-edge throttle for native/system notifications only.
      // The in-app unread state above is published immediately.
      if (now - lastNotifiedAt < BELL_NOTIFICATION_THROTTLE_MS) return
      lastSystemNotificationAtByTerminalKey.set(descriptor.terminalKey, now)
      const repoName = lastPathSegment(descriptor.repoRoot)
      const bodyParts = [descriptor.branch]
      const canonicalTitle = typeof event.canonicalTitle === 'string' ? event.canonicalTitle.trim() : ''
      if (canonicalTitle) bodyParts.push(canonicalTitle)
      else if (event.processName) bodyParts.push(event.processName)
      void terminalBridge
        .notifyBell({
          title: repoName,
          body: bodyParts.join('\n'),
          terminalKey: descriptor.terminalKey,
          repoRoot: descriptor.repoRoot,
        })
        .catch(() => {})
    },
  }
}
