// Server-side terminal runtime. Single holder of the business state
// for a Goblin server instance: the session manager, the catalog, the
// realtime broker, the connection-state tracker, and the realtime
// dispatch table. Exposes a `ServerTerminalHost` to the Hono realtime
// route. Holds no PTY state itself — the `PtySupervisor` injected at
// construction owns the PTY pool (in-process or worker-backed).
//
// Layering: this file is the server-side "write" layer for the
// terminal feature. Routes call into it; nothing inside it calls out
// to the route layer.

import { BufferedTerminalSocket } from '#/server/terminal/buffered-terminal-socket.ts'
import type { TerminalClientMessage } from '#/shared/terminal-socket.ts'
import { normalizeTerminalClientMessage } from '#/shared/terminal-validators.ts'
import { serverLogger } from '#/server/logger.ts'
import { createTerminalCatalog } from '#/server/terminal/terminal-catalog.ts'
import { createTerminalSessionOrderRuntime } from '#/server/terminal/terminal-session-order-runtime.ts'
import type { TerminalRealtimeBroker, TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'
import { createTerminalRuntimeCoordinator } from '#/server/terminal/terminal-runtime-coordinator.ts'
import {
  createTerminalRealtimeHandlers,
  handleTerminalRealtimeRequestMessage,
  shouldPauseRealtimeRequest,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import { isValidTerminalClientId, isValidTerminalSessionId } from '#/server/terminal/terminal-session-ids.ts'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { type ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { GoblinTerminalCommandRuntime } from '#/server/terminal/g-command.ts'

// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up. (The previous revision also kept a 30s controller grace
// timer here; it has been removed — controller effectiveness now derives from
// broker presence.)
const TERMINAL_DETACHED_TTL_MS = 24 * 60 * 60 * 1000
const terminalRuntimeLogger = serverLogger.child({ module: 'terminal-runtime' })

export interface ServerTerminalRuntimeOptions {
  ptySupervisor: PtySupervisor
  gCommand?: GoblinTerminalCommandRuntime
}

export interface ServerTerminalRuntime {
  host: ServerTerminalHost
  shutdown(): void
}

export function createServerTerminalRuntime(options: ServerTerminalRuntimeOptions): ServerTerminalRuntime {
  const { ptySupervisor } = options
  const terminalSessionOrder = createTerminalSessionOrderRuntime<string>()

  // Sink callbacks fan out to every clientId that shares the
  // session's userId. The manager passes `userId` (a string
  // derived from the access token) rather than `clientId`, so a
  // live output event reaches a sibling tab (different `clientId`,
  // same `userId`) without an extra attach roundtrip. See
  // `identity.ts` for the model.
  let broker: TerminalRealtimeBroker
  const manager = new TerminalSessionManager<string>(
    ptySupervisor,
    {
      onOutput(userId, event) {
        broker.broadcastToUser(userId, { type: 'output', event })
      },
      onTitle(userId, event) {
        broker.broadcastToUser(userId, { type: 'title', event })
      },
      onExit(userId, event) {
        const repoRoot = manager.getSession(userId, event.ptySessionId)?.scope
        broker.broadcastToUser(userId, { type: 'exit', event })
        if (repoRoot) broadcastRepoSessionsChanged(userId, repoRoot)
      },
      onIdentity(userId, event) {
        broker.broadcastToUser(userId, { type: 'identity', event })
      },
      onLifecycle(userId, event) {
        broker.broadcastToUser(userId, { type: 'lifecycle', event })
      },
    },
    terminalSessionOrder,
    (userId, clientId) => broker.isClientOnline(userId, clientId),
  )
  const coordinator = createTerminalRuntimeCoordinator({
    manager,
    terminalSessionOrder,
    detachedTtlMs: TERMINAL_DETACHED_TTL_MS,
  })
  broker = coordinator.broker
  const catalog = createTerminalCatalog({
    isValidClientId: isValidTerminalClientId,
    isValidTerminalSessionId,
    manager,
    broadcastSessionsChanged(userId, repoRoot) {
      broadcastRepoSessionsChanged(userId, repoRoot)
    },
    gCommand: options.gCommand,
  })

  const bufferedSocketByRawSocket = new WeakMap<TerminalRealtimeSocket, BufferedTerminalSocket>()
  let shuttingDown = false
  const actions = createTerminalRuntimeActions({
    manager,
    broker,
    catalog,
    isValidTerminalClientId,
  })

  const host: ServerTerminalHost = {
    isValidClientId(value) {
      return isValidTerminalClientId(value)
    },
    isClientOnline(userId, clientId) {
      return broker.isClientOnline(userId, clientId)
    },
    getDiagnostics() {
      const bufferStats = manager.getSessionBufferStats()
      return {
        mode: ptySupervisor.getDiagnostics().mode,
        state: shuttingDown ? 'shutting-down' : 'running',
        registeredSockets: broker.socketCount(),
        shuttingDown,
        pty: ptySupervisor.getDiagnostics(),
        liveSessionCount: bufferStats.count,
        totalRingBufferChars: bufferStats.totalBufferChars,
        maxRingBufferChars: bufferStats.maxBufferChars,
      }
    },
    registerSocket(clientId, userId, socket) {
      if (typeof clientId !== 'string' || !isValidTerminalClientId(clientId) || !userId) {
        socket.close(1008, 'invalid client id')
        return
      }
      const rawSocket = socket as TerminalRealtimeSocket
      let buffered: BufferedTerminalSocket
      buffered = new BufferedTerminalSocket(rawSocket, () => {
        broker.unregisterSocket(buffered)
        bufferedSocketByRawSocket.delete(rawSocket)
      })
      bufferedSocketByRawSocket.set(rawSocket, buffered)
      broker.registerSocket(clientId, userId, buffered)
    },
    unregisterSocket(clientId, userId, socket) {
      const buffered =
        bufferedSocketByRawSocket.get(socket as TerminalRealtimeSocket) ?? (socket as TerminalRealtimeSocket)
      if (buffered instanceof BufferedTerminalSocket) buffered.deactivate()
      broker.unregisterSocket(buffered)
      bufferedSocketByRawSocket.delete(socket as TerminalRealtimeSocket)
    },
    async attach(clientId, userId, input) {
      return await actions.attach(clientId, userId, input)
    },
    async restart(clientId, userId, input) {
      return await actions.restart(clientId, userId, input)
    },
    write(clientId, userId, input) {
      return actions.write(clientId, userId, input)
    },
    resize(clientId, userId, input) {
      return actions.resize(clientId, userId, input)
    },
    takeover(clientId, userId, input) {
      return actions.takeover(clientId, userId, input)
    },
    close(clientId, userId, input) {
      return actions.close(clientId, userId, input)
    },
    async listSessions(clientId, userId, repoRoot) {
      return await actions.listSessions(clientId, userId, repoRoot)
    },
    async create(clientId, userId, input) {
      return await actions.create(clientId, userId, input)
    },
    async prune(clientId, userId, repoRoot) {
      return await actions.prune(clientId, userId, repoRoot)
    },
    async getSessionSnapshot(clientId, userId, input) {
      return await actions.getSessionSnapshot(clientId, userId, input)
    },
    handleRealtimeMessage(clientId, userId, socket, payload) {
      // Log invalid identifier/parse drops so a stuck takeover
      // (e.g. an old clientId pattern that the WS validator
      // missed) is observable in production logs. We still
      // return early without rejecting the WS — the message is
      // just unprocessable for this socket.
      if (typeof clientId !== 'string' || !isValidTerminalClientId(clientId)) {
        terminalRuntimeLogger.warn({ clientId }, 'invalid realtime message: missing/invalid identifiers')
        return
      }
      if (!userId) {
        terminalRuntimeLogger.warn({ clientId }, 'invalid realtime message: missing userId from auth context')
        return
      }
      let message: TerminalClientMessage | null = null
      try {
        message = normalizeTerminalClientMessage(JSON.parse(payload))
      } catch (err) {
        terminalRuntimeLogger.warn({ clientId, err }, 'invalid realtime message: parse/normalize failed')
        return
      }
      if (!message) {
        terminalRuntimeLogger.warn({ clientId }, 'invalid realtime message: null after normalize')
        return
      }
      if (message.type === 'heartbeat') {
        // Heartbeats are not request/response — they're a pure
        // liveness signal that feeds the broker's deadline scan.
        // Resolving here means the rest of the realtime pipeline
        // (buffered socket, handler table) stays untouched.
        broker.recordHeartbeat(userId, clientId)
        return
      }
      if (message.type === 'ping') {
        broker.recordHeartbeat(userId, clientId)
        const rawSocket = socket as TerminalRealtimeSocket
        try {
          rawSocket.send(JSON.stringify({ type: 'pong', requestId: message.requestId }))
        } catch {
          bufferedSocketByRawSocket.get(rawSocket)?.deactivate()
        }
        return
      }
      const bufferedSocket = bufferedSocketByRawSocket.get(socket as TerminalRealtimeSocket)
      if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.pause()
      void handleTerminalRealtimeRequestMessage(
        realtimeHandlers,
        clientId,
        userId,
        socket as TerminalRealtimeSocket,
        bufferedSocket,
        message,
      )
    },
    shutdown() {
      if (shuttingDown) return
      shuttingDown = true
      coordinator.shutdown()
      manager.closeAll()
      ptySupervisor.shutdown()
    },
  }

  const realtimeHandlers = createTerminalRealtimeHandlers(host)

  terminalRuntimeLogger.info({ ptyMode: ptySupervisor.getDiagnostics().mode }, 'server terminal runtime created')

  return {
    host,
    shutdown() {
      host.shutdown()
    },
  }

  function broadcastRepoSessionsChanged(userId: string, repoRoot: string): void {
    broker.broadcastToUser(userId, { type: 'sessions-changed', repoRoot })
  }
}
