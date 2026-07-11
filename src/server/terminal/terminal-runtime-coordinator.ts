import { TerminalDetachedUserTimer } from '#/server/terminal/terminal-detached-user-timer.ts'
import { RealtimeBroker } from '#/server/realtime/realtime-broker.ts'
import type { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { AppRealtimeMessage } from '#/shared/app-realtime-socket.ts'
import { serverLogger } from '#/server/logger.ts'

const terminalRuntimeCoordinatorLogger = serverLogger.child({ module: 'terminal-runtime-coordinator' })

export interface TerminalRuntimeCoordinatorOptions {
  manager: TerminalSessionManager<string>
  workspaceTabsCoordinator: Pick<WorkspacePaneTabsCoordinator, 'closeUser'>
  detachedTtlMs: number
}

export interface TerminalRuntimeCoordinator {
  broker: RealtimeBroker<AppRealtimeMessage>
  shutdown(): void
}

export function createTerminalRuntimeCoordinator(
  options: TerminalRuntimeCoordinatorOptions,
): TerminalRuntimeCoordinator {
  const { manager, workspaceTabsCoordinator, detachedTtlMs } = options

  // Detached-user timers key by userId, not clientId. clientId is only
  // the per-tab routing id; terminal lifetime is owned by the
  // access-token-derived userId.
  const detachedUsers = new TerminalDetachedUserTimer({
    detachedTtlMs,
    onUserExpired(userId) {
      void closeDetachedUserRuntime(userId).catch((err) => {
        terminalRuntimeCoordinatorLogger.warn({ userId, err }, 'failed to clean up detached user runtime')
      })
    },
  })

  const broker = new RealtimeBroker<AppRealtimeMessage>({
    heartbeatTimeoutReason: 'terminal heartbeat timeout',
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

  async function closeDetachedUserRuntime(userId: string): Promise<void> {
    if (!(await manager.closeSessionsForUser(userId))) return
    await workspaceTabsCoordinator.closeUser({ userId })
  }
}
