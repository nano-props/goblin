import { TerminalDetachedUserTimer } from '#/server/terminal/terminal-detached-user-timer.ts'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { TerminalWorkspaceTabsRuntime } from '#/server/terminal/terminal-workspace-tabs-runtime.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  workspaceTabs: TerminalWorkspaceTabsRuntime<string>
  detachedTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: TerminalRealtimeBroker
  shutdown(): void
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, workspaceTabs, detachedTtlMs } = options

  // Detached-user timers key by userId, not clientId. clientId is only
  // the per-tab routing id; terminal lifetime is owned by the
  // access-token-derived userId.
  const detachedUsers = new TerminalDetachedUserTimer({
    detachedTtlMs,
    onUserExpired(userId) {
      manager.closeSessionsForUser(userId)
      workspaceTabs.closeSessionsForUser(userId)
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

  return {
    broker,
    shutdown() {
      // Draining broker sockets can synchronously unregister buffered sockets
      // and schedule detached-user timers. Stop those timers after the broker
      // drain so runtime shutdown cannot leave a 24h cleanup timeout behind.
      broker.disconnectAll()
      detachedUsers.shutdown()
    },
  }
}
