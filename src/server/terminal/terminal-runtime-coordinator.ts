import { TerminalConnectionState } from '#/server/terminal/terminal-connection-state.ts'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { TerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
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

  // The connection-state timers key by owner, not clientId. clientId
  // is only the per-tab routing id; terminal lifetime is owned by
  // the access-token-derived ownerId.
  const connectionState = new TerminalConnectionState({
    detachedTtlMs,
    onOwnerExpired(ownerId) {
      manager.closeSessionsForOwner(ownerId)
      terminalViewOrder.closeViewsForOwner(ownerId)
    },
  })

  const broker = new TerminalRealtimeBroker({
    onAttachmentConnected(_clientId, attachmentId, ownerId) {
      connectionState.clearOwnerDisconnect(ownerId)
      manager.setAttachmentConnected(ownerId, attachmentId, true)
    },
    onAttachmentDisconnected(_clientId, attachmentId, ownerId) {
      // Disconnect is immediate: the controller slot clears on
      // disconnect and the next attach from any sibling attachment
      // auto-claims (see `terminal-ownership.ts`). The detached TTL
      // is the only timer we still schedule on disconnect — it
      // covers the "all sockets gone, drop the catalog" path.
      manager.setAttachmentConnected(ownerId, attachmentId, false)
      connectionState.scheduleOwnerDisconnect(ownerId, () => broker.hasOwnerSockets(ownerId))
    },
    onOwnerDisconnected(ownerId) {
      connectionState.scheduleOwnerDisconnect(ownerId, () => broker.hasOwnerSockets(ownerId))
    },
  })

  return { broker, connectionState }
}
