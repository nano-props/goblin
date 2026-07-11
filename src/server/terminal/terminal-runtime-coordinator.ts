import { DelayedPresenceExpiry } from '#/server/realtime/delayed-presence-expiry.ts'
import { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import {
  captureRepoRuntimeMembershipLease,
  expireRepoRuntimeMembershipLease,
} from '#/server/modules/repo-runtimes.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { serverLogger } from '#/server/logger.ts'

const terminalRuntimeCoordinatorLogger = serverLogger.child({ module: 'terminal-runtime-coordinator' })

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  workspaceTabsCoordinator: Pick<WorkspacePaneTabsCoordinator, 'closeUser'>
  detachedTtlMs: number
  repoMembershipTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: RealtimeBroker<AppRealtimeMessage>
  shutdown(): void
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, workspaceTabsCoordinator, detachedTtlMs, repoMembershipTtlMs } = options

  // Detached-user timers key by userId, not clientId. clientId is only
  // the per-tab routing id; terminal lifetime is owned by the
  // access-token-derived userId.
  const detachedUsers = new DelayedPresenceExpiry<string>(detachedTtlMs)
  const detachedClients = new DelayedPresenceExpiry<string>(repoMembershipTtlMs)

  const broker = new RealtimeBroker<AppRealtimeMessage>({
    heartbeatTimeoutReason: 'terminal heartbeat timeout',
    onClientPresenceChanged(event) {
      const clientKey = repoRuntimeClientLeaseKey(event.userId, event.clientId)
      if (event.online) {
        detachedUsers.cancel(event.userId)
        detachedClients.cancel(clientKey)
      } else {
        const lease = captureRepoRuntimeMembershipLease(event.userId, event.clientId)
        detachedClients.schedule(
          clientKey,
          () => broker.isClientOnline(event.userId, event.clientId),
          () => expireRepoRuntimeMembershipLease(lease),
        )
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

  return {
    broker,
    shutdown() {
      // Draining broker sockets can synchronously unregister buffered sockets
      // and schedule detached-user timers. Stop those timers after the broker
      // drain so runtime shutdown cannot leave a 24h cleanup timeout behind.
      broker.disconnectAll()
      detachedUsers.shutdown()
      detachedClients.shutdown()
    },
  }

  async function closeDetachedUserRuntime(userId: string): Promise<void> {
    if (!(await manager.closeSessionsForUser(userId))) return
    await workspaceTabsCoordinator.closeUser({ userId })
  }
}

function repoRuntimeClientLeaseKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}
