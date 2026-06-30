import { TerminalDetachedUserTimer } from '#/server/terminal/terminal-detached-user-timer.ts'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { TerminalSessionOrderRuntime } from '#/server/terminal/terminal-session-order-runtime.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  terminalSessionOrder: TerminalSessionOrderRuntime<string>
  detachedTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: TerminalRealtimeBroker
  detachedUsers: TerminalDetachedUserTimer
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, terminalSessionOrder, detachedTtlMs } = options

  // Detached-user timers key by userId, not clientId. clientId is only
  // the per-tab routing id; terminal lifetime is owned by the
  // access-token-derived userId.
  const detachedUsers = new TerminalDetachedUserTimer({
    detachedTtlMs,
    onUserExpired(userId) {
      manager.closeSessionsForUser(userId)
      terminalSessionOrder.closeSessionsForUser(userId)
    },
  })

  const broker = new TerminalRealtimeBroker({
    onClientPresenceChanged(event) {
      if (event.online) detachedUsers.clearUserDetachedTimer(event.userId)
      else detachedUsers.scheduleUserDetachedTimer(event.userId, () => broker.hasOnlineUserClients(event.userId))
      manager.handleClientPresenceChanged(event.userId, event.clientId, event.previousOnline)
    },
    onUserSocketsDrained(userId) {
      if (!detachedUsers.hasUserDetachedTimer(userId)) {
        detachedUsers.scheduleUserDetachedTimer(userId, () => broker.hasOnlineUserClients(userId))
      }
    },
  })

  return { broker, detachedUsers }
}
