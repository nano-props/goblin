import { TerminalConnectionState } from '#/server/terminal/terminal-connection-state.ts'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalSlotManager } from '#/server/terminal/terminal-slot-manager.ts'
import type { TerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSlotManager<string>
  terminalViewOrder: TerminalViewOrderRuntime<string>
  detachedTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: TerminalRealtimeBroker
  connectionState: TerminalConnectionState
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, terminalViewOrder, detachedTtlMs } = options

  // The connection-state timers key by userId, not clientId. clientId
  // is only the per-tab routing id; terminal lifetime is owned by
  // the access-token-derived userId.
  const connectionState = new TerminalConnectionState({
    detachedTtlMs,
    onUserExpired(userId) {
      manager.closeSessionsForUser(userId)
      terminalViewOrder.closeViewsForUser(userId)
    },
  })

  const broker = new TerminalRealtimeBroker({
    onClientConnected(clientId, userId) {
      connectionState.clearUserDisconnect(userId)
      manager.setClientConnected(userId, clientId, true)
    },
    onClientDisconnected(clientId, userId) {
      // Disconnect is immediate: the controller slot clears on
      // disconnect and the next attach from any sibling attachment
      // auto-claims (see `terminal-controller.ts`). The detached TTL
      // is the only timer we still schedule on disconnect — it
      // covers the "all sockets gone, drop the catalog" path.
      manager.setClientConnected(userId, clientId, false)
      connectionState.scheduleUserDisconnect(userId, () => broker.hasUserSockets(userId))
    },
    onUserDisconnected(userId) {
      connectionState.scheduleUserDisconnect(userId, () => broker.hasUserSockets(userId))
    },
  })

  return { broker, connectionState }
}
