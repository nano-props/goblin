import { TerminalConnectionState } from '#/server/terminal/terminal-connection-state.ts'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { TerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  terminalViewOrder: TerminalViewOrderRuntime<string>
  ownershipGraceMs: number
  detachedTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: TerminalRealtimeBroker
  connectionState: TerminalConnectionState
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, terminalViewOrder, ownershipGraceMs, detachedTtlMs } = options

  // The connection-state timers key by owner, not clientId. clientId
  // is only the per-tab routing id; terminal lifetime is owned by
  // the access-token-derived ownerId.
  const connectionState = new TerminalConnectionState({
    ownershipGraceMs,
    detachedTtlMs,
    onAttachmentExpired(ownerId, attachmentId) {
      manager.expireAttachment(ownerId, attachmentId)
    },
    onOwnerExpired(ownerId) {
      manager.closeSessionsForOwner(ownerId)
      terminalViewOrder.closeViewsForOwner(ownerId)
    },
  })

  const broker = new TerminalRealtimeBroker({
    onAttachmentConnected(_clientId, attachmentId, ownerId) {
      connectionState.clearOwnerDisconnect(ownerId)
      connectionState.clearAttachmentDisconnect(ownerId, attachmentId)
      manager.setAttachmentConnected(ownerId, attachmentId, true)
    },
    onAttachmentDisconnected(_clientId, attachmentId, ownerId) {
      manager.setAttachmentConnected(ownerId, attachmentId, false)
      connectionState.scheduleOwnershipRelease(
        ownerId,
        attachmentId,
        () => broker.isAttachmentConnected(ownerId, attachmentId) === true,
      )
    },
    onOwnerDisconnected(ownerId) {
      connectionState.scheduleOwnerDisconnect(ownerId, () => broker.hasOwnerSockets(ownerId))
    },
  })

  return { broker, connectionState }
}
