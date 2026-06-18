import { TerminalConnectionState } from '#/server/terminal/terminal-connection-state.ts'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
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
  const { manager, ownershipGraceMs, detachedTtlMs } = options

  // The connection-state timers key by (clientId, attachmentId)
  // because they are per-WS-connection lifecycles. The callbacks
  // carry `ownerId` so the manager (which is ownerId-partitioned
  // under method 2) can be reached without re-deriving identity.
  const connectionState = new TerminalConnectionState({
    ownershipGraceMs,
    detachedTtlMs,
    onAttachmentExpired(_clientId, attachmentId, ownerId) {
      manager.expireAttachment(ownerId, attachmentId)
    },
    onClientExpired(_clientId, ownerId) {
      manager.closeOwner(ownerId)
    },
  })

  const broker = new TerminalRealtimeBroker({
    onAttachmentConnected(clientId, attachmentId, ownerId) {
      connectionState.clearClientDisconnect(clientId)
      connectionState.clearAttachmentDisconnect(clientId, attachmentId)
      manager.setAttachmentConnected(ownerId, attachmentId, true)
    },
    onAttachmentDisconnected(clientId, attachmentId, ownerId) {
      manager.setAttachmentConnected(ownerId, attachmentId, false)
      connectionState.scheduleOwnershipRelease(
        clientId,
        attachmentId,
        ownerId,
        () => broker.attachmentIsConnected(clientId, attachmentId) === true,
      )
    },
    onClientDisconnected(clientId, ownerId) {
      connectionState.scheduleClientDisconnect(clientId, ownerId, () =>
        broker.hasClientSockets(clientId),
      )
    },
  })

  return { broker, connectionState }
}
