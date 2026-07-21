import { DelayedPresenceExpiry } from '#/server/realtime/delayed-presence-expiry.ts'
import { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import {
  captureWorkspaceRuntimeMembershipLease,
  expireWorkspaceRuntimeMembershipLease,
  onWorkspaceRuntimeMembershipAcquired,
} from '#/server/modules/workspace-runtimes.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { serverLogger } from '#/server/logger.ts'

const terminalRuntimeCoordinatorLogger = serverLogger.child({ module: 'terminal-runtime-coordinator' })

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  workspaceTabsCoordinator: Pick<WorkspacePaneTabsCoordinator, 'closeUser'>
  detachedTtlMs: number
  clientStateTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: RealtimeBroker<AppRealtimeMessage>
  shutdown(): void
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, workspaceTabsCoordinator, detachedTtlMs, clientStateTtlMs } = options

  // Detached-user timers key by userId, not clientId. clientId is only
  // the page-instance routing id; terminal lifetime is owned by the
  // access-token-derived userId.
  const detachedUsers = new DelayedPresenceExpiry<string>(detachedTtlMs)
  const clientStateExpiry = new DelayedPresenceExpiry<string>(clientStateTtlMs)

  const broker = new RealtimeBroker<AppRealtimeMessage>({
    heartbeatTimeoutReason: 'terminal heartbeat timeout',
    onClientPresenceChanged(event) {
      const clientKey = workspaceRuntimeClientLeaseKey(event.userId, event.clientId)
      if (event.online) {
        detachedUsers.cancel(event.userId)
        clientStateExpiry.cancel(clientKey)
      } else {
        scheduleClientStateExpiry(event.userId, event.clientId)
      }
      manager.handleClientPresenceChanged(event.userId, event.clientId, event.previousOnline)
    },
    onUserSocketsDrained(userId) {
      if (!detachedUsers.has(userId)) {
        detachedUsers.schedule(
          userId,
          () => broker.hasOnlineUserClients(userId),
          () => {
            void closeDetachedUserRuntime(userId).catch((err) => {
              terminalRuntimeCoordinatorLogger.warn({ userId, err }, 'failed to clean up detached user runtime')
            })
          },
        )
      }
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
      // Draining broker sockets can synchronously unregister buffered sockets
      // and schedule detached-user timers. Stop those timers after the broker
      // drain so runtime shutdown cannot leave a 24h cleanup timeout behind.
      broker.disconnectAll()
      unsubscribeMembershipAcquired()
      detachedUsers.shutdown()
      clientStateExpiry.shutdown()
    },
  }

  async function closeDetachedUserRuntime(userId: string): Promise<void> {
    const retirement = await manager.closeSessionsForUser(userId)
    if (retirement.failures.length > 0) return
    await workspaceTabsCoordinator.closeUser({ userId })
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
