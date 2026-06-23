// Server-side terminal runtime. Single owner of the business state
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
import { createTerminalViewOrderRuntime } from '#/server/terminal/terminal-view-order-runtime.ts'
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
import { createTerminalRuntimeActions } from '#/server/terminal/terminal-runtime-actions.ts'
import { createTerminalRuntimeCoordinator } from '#/server/terminal/terminal-runtime-coordinator.ts'
import {
  createTerminalRealtimeHandlers,
  handleTerminalRealtimeRequestMessage,
  shouldPauseRealtimeRequest,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import {
  isValidTerminalClientId,
  isValidTerminalId,
} from '#/server/terminal/terminal-runtime-support.ts'
import { TerminalSlotManager } from '#/server/terminal/terminal-slot-manager.ts'
import { type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { type ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { GoblinTerminalCommandRuntime } from '#/server/terminal/g-command.ts'

// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up. (The previous revision also kept a 30s ownership
// grace timer here; it has been removed — see `terminal-ownership.ts` for
// the new disconnect-clears-controller semantics.)
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
  const terminalViewOrder = createTerminalViewOrderRuntime<string>()

  // Sink callbacks fan out to every clientId that shares the
  // session's userId. The manager passes `userId` (a string
  // derived from the access token) rather than `clientId`, so a
  // live output event reaches a sibling tab (different `clientId`,
  // same `userId`) without an extra attach roundtrip. See
  // `identity.ts` for the model.
  const manager = new TerminalSlotManager<string>(
    ptySupervisor,
    {
      onOutput(userId, event) {
        broker.broadcastToOwner(userId, { type: 'output', event })
      },
      onTitle(userId, event) {
        broker.broadcastToOwner(userId, { type: 'title', event })
      },
      onExit(userId, event) {
        const repoRoot = manager.getSlot(userId, event.ptySessionId)?.scope
        broker.broadcastToOwner(userId, { type: 'exit', event })
        if (repoRoot) broadcastRepoSessionsChanged(userId, repoRoot)
      },
      onOwnership(userId, event) {
        broker.broadcastToOwner(userId, { type: 'ownership', event })
      },
    },
    terminalViewOrder,
  )
  const { broker, connectionState } = createTerminalRuntimeCoordinator({
    manager,
    terminalViewOrder,
    detachedTtlMs: TERMINAL_DETACHED_TTL_MS,
  })
  const catalog = createTerminalCatalog({
    isValidClientId: isValidTerminalClientId,
    isValidTerminalId,
    manager,
    isClientConnected(userId, clientId) {
      return broker.isClientConnected(userId, clientId)
    },
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
    // The previous stub returned `true` whenever an clientId
    // was present (see `resolveClientConnected` before this
    // plan), which made the takeover path "work" for the first
    // browser tab but masked the fact that we never asked the
    // broker. Replacing with the broker check ensures a takeover
    // request from a brand-new tab (the cross-browser scenario)
    // only counts the attachment as connected if the WS is
    // actually alive for the (userId, clientId) pair.
    resolveClientConnected(userId, clientId) {
      return broker.isClientConnected(userId, clientId) ?? false
    },
  })

  const host: ServerTerminalHost = {
    isValidClientId(value) {
      return isValidTerminalClientId(value)
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
      if (!isValidTerminalClientId(clientId) || !userId) {
        socket.close(1008, 'invalid client id')
        return
      }
      const buffered = new BufferedTerminalSocket(socket as TerminalRealtimeSocket)
      bufferedSocketByRawSocket.set(socket as TerminalRealtimeSocket, buffered)
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
    async getSlotSnapshot(clientId, userId, input) {
      return await actions.getSlotSnapshot(clientId, userId, input)
    },
    handleRealtimeMessage(clientId, userId, socket, payload) {
      // Log invalid identifier/parse drops so a stuck takeover
      // (e.g. an old clientId pattern that the WS validator
      // missed) is observable in production logs. We still
      // return early without rejecting the WS — the message is
      // just unprocessable for this socket.
      if (!isValidTerminalClientId(clientId)) {
        terminalRuntimeLogger.warn({ clientId }, 'invalid realtime message: missing/invalid identifiers')
        return
      }
      if (!userId) {
        terminalRuntimeLogger.warn(
          { clientId },
          'invalid realtime message: missing userId from auth context',
        )
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
      connectionState.shutdown()
      broker.disconnectAll()
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
    broker.broadcastToOwner(userId, { type: 'sessions-changed', repoRoot })
  }
}
