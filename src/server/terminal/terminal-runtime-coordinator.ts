import { DelayedPresenceExpiry } from '#/server/realtime/delayed-presence-expiry.ts'
import { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import {
  captureWorkspaceRuntimeMembershipLease,
  expireWorkspaceRuntimeMembershipLease,
  onWorkspaceRuntimeMembershipAcquired,
} from '#/server/modules/workspace-runtimes.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  clientStateTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: RealtimeBroker<AppRealtimeMessage>
  shutdown(): void
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, clientStateTtlMs } = options
  const clientStateExpiry = new DelayedPresenceExpiry<string>(clientStateTtlMs)

  const broker = new RealtimeBroker<AppRealtimeMessage>({
    livenessTimeoutReason: 'terminal liveness timeout',
    onUserSocketsDrained() {},
    onClientPresenceChanged(event) {
      const clientKey = workspaceRuntimeClientLeaseKey(event.userId, event.clientId)
      if (event.online) {
        clientStateExpiry.cancel(clientKey)
      } else {
        scheduleClientStateExpiry(event.userId, event.clientId)
      }
      manager.handleClientPresenceChanged(event.userId, event.clientId, event.previousOnline)
    },
  })
  const unsubscribeMembershipAcquired = onWorkspaceRuntimeMembershipAcquired(({ userId, clientId }) => {
    const clientKey = workspaceRuntimeClientLeaseKey(userId, clientId)
    if (broker.isClientOnline(userId, clientId)) {
      clientStateExpiry.cancel(clientKey)
      return
    }
    scheduleClientStateExpiry(userId, clientId)
  })

  return {
    broker,
    shutdown() {
      // Stop transport liveness before releasing presence listeners and their
      // client-state timers.
      broker.disconnectAll()
      unsubscribeMembershipAcquired()
      clientStateExpiry.shutdown()
    },
  }

  function scheduleClientStateExpiry(userId: string, clientId: string): void {
    const lease = captureWorkspaceRuntimeMembershipLease(userId, clientId)
    clientStateExpiry.schedule(
      workspaceRuntimeClientLeaseKey(userId, clientId),
      () => broker.isClientOnline(userId, clientId),
      () => {
        manager.expireClientAttachments(userId, clientId)
        expireWorkspaceRuntimeMembershipLease(lease)
      },
    )
  }
}

function workspaceRuntimeClientLeaseKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}
