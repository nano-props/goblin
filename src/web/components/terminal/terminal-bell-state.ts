import { lastPathSegment } from '#/web/lib/paths.ts'
import { terminalClient } from '#/web/terminal.ts'
import type { TerminalBellPolicyEvent, TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { getRuntimeFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { terminalPresentationBranch, terminalSessionBase, terminalSessionCoordinates } from '#/shared/terminal-types.ts'
const BELL_NOTIFICATION_THROTTLE_MS = 5000

export interface TerminalBellState {
  hasBell: (terminalSessionId: string) => boolean
  clear: (terminalSessionId: string) => boolean
  remove: (terminalSessionId: string) => void
  reset: () => void
  handleBell: (descriptor: TerminalDescriptor, event: TerminalBellPolicyEvent) => void
}

export function createTerminalBellState(
  notify: (terminalSessionId?: string) => void,
  onBadgeChange: (count: number) => void,
): TerminalBellState {
  // Client-local UI state only. Server bell events are not replayed or
  // persisted, and this unread set is rebuilt from live realtime events.
  const unreadSessionIds = new Set<string>()
  const lastSystemNotificationAtByTerminalSessionId = new Map<string, number>()

  onBadgeChange(unreadSessionIds.size)

  function notifyAndBadge(terminalSessionId?: string) {
    notify(terminalSessionId)
    onBadgeChange(unreadSessionIds.size)
  }

  return {
    hasBell(terminalSessionId) {
      return unreadSessionIds.has(terminalSessionId)
    },
    clear(terminalSessionId) {
      const changed = unreadSessionIds.delete(terminalSessionId)
      if (changed) notifyAndBadge(terminalSessionId)
      return changed
    },
    remove(terminalSessionId) {
      const had = unreadSessionIds.has(terminalSessionId)
      unreadSessionIds.delete(terminalSessionId)
      lastSystemNotificationAtByTerminalSessionId.delete(terminalSessionId)
      if (had) notifyAndBadge(terminalSessionId)
    },
    reset() {
      const had = unreadSessionIds.size > 0
      unreadSessionIds.clear()
      lastSystemNotificationAtByTerminalSessionId.clear()
      if (had) notifyAndBadge()
    },
    handleBell(descriptor, event) {
      const windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true
      if (event.visible && windowFocused) return
      const changed = !unreadSessionIds.has(descriptor.terminalSessionId)
      unreadSessionIds.add(descriptor.terminalSessionId)
      if (changed) notifyAndBadge(descriptor.terminalSessionId)
      if (!getRuntimeFetchSettings().terminalNotificationsEnabled) return
      const now = Date.now()
      const lastNotifiedAt = lastSystemNotificationAtByTerminalSessionId.get(descriptor.terminalSessionId) ?? 0
      // Leading-edge throttle for native/system notifications only.
      // The in-app unread state above is published immediately.
      if (now - lastNotifiedAt < BELL_NOTIFICATION_THROTTLE_MS) return
      lastSystemNotificationAtByTerminalSessionId.set(descriptor.terminalSessionId, now)
      const repoName = lastPathSegment(terminalSessionCoordinates(descriptor).workspaceId)
      const bodyParts = terminalPresentationBranch(descriptor.presentation)
        ? [terminalPresentationBranch(descriptor.presentation)]
        : []
      const canonicalTitle = typeof event.canonicalTitle === 'string' ? event.canonicalTitle.trim() : ''
      if (canonicalTitle) bodyParts.push(canonicalTitle)
      else if (event.processName) bodyParts.push(event.processName)
      void terminalClient
        .notifyBell({
          title: repoName,
          body: bodyParts.join('\n'),
          terminalSessionId: descriptor.terminalSessionId,
          session: terminalSessionBase(descriptor.target, descriptor.presentation),
        })
        .catch(() => {})
    },
  }
}
