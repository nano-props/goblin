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

  const connectionState = new TerminalConnectionState({
    ownershipGraceMs,
    detachedTtlMs,
    onAttachmentExpired(clientId, attachmentId) {
      manager.expireAttachment(clientId, attachmentId)
    },
    onClientExpired(clientId) {
      manager.closeOwner(clientId)
    },
  })

  const broker = new TerminalRealtimeBroker({
    onAttachmentConnected(clientId, attachmentId) {
      connectionState.clearClientDisconnect(clientId)
      connectionState.clearAttachmentDisconnect(clientId, attachmentId)
      manager.setAttachmentConnected(clientId, attachmentId, true)
    },
    onAttachmentDisconnected(clientId, attachmentId) {
      manager.setAttachmentConnected(clientId, attachmentId, false)
      connectionState.scheduleOwnershipRelease(
        clientId,
        attachmentId,
        () => broker.attachmentIsConnected(clientId, attachmentId) === true,
      )
    },
    onClientDisconnected(clientId) {
      connectionState.scheduleClientDisconnect(clientId, () => broker.hasClientSockets(clientId))
    },
  })

  return { broker, connectionState }
}
