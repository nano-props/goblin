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
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
import {
  createTerminalRuntimeActions,
  withSessionSnapshot,
} from '#/server/terminal/terminal-runtime-actions.ts'
import { createTerminalRuntimeCoordinator } from '#/server/terminal/terminal-runtime-coordinator.ts'
import {
  createTerminalRealtimeHandlers,
  handleTerminalRealtimeRequestMessage,
  shouldPauseRealtimeRequest,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import {
  isValidTerminalClientId,
  isValidTerminalId,
  isValidTerminalSocketAttachmentId,
  resolveAttachmentConnected,
} from '#/server/terminal/terminal-runtime-support.ts'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { type ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up.
const TERMINAL_DETACHED_TTL_MS = 24 * 60 * 60 * 1000
const TERMINAL_OWNERSHIP_GRACE_MS = 30_000
const terminalRuntimeLogger = serverLogger.child({ module: 'terminal-runtime' })

export interface ServerTerminalRuntimeOptions {
  ptySupervisor: PtySupervisor
}

export interface ServerTerminalRuntime {
  host: ServerTerminalHost
  shutdown(): void
}

export function createServerTerminalRuntime(options: ServerTerminalRuntimeOptions): ServerTerminalRuntime {
  const { ptySupervisor } = options

  const manager = new TerminalSessionManager<string>(ptySupervisor, {
    onOutput(clientId, event) {
      broker.broadcast(clientId, { type: 'output', event })
    },
    onTitle(clientId, event) {
      broker.broadcast(clientId, { type: 'title', event })
    },
    onExit(clientId, event) {
      const repoRoot = manager.getSession(clientId, event.sessionId)?.scope
      broker.broadcast(clientId, { type: 'exit', event })
      if (repoRoot) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot })
    },
    onOwnership(clientId, event) {
      broker.broadcast(clientId, { type: 'ownership', event })
    },
  })
  const { broker, connectionState } = createTerminalRuntimeCoordinator({
    manager,
    ownershipGraceMs: TERMINAL_OWNERSHIP_GRACE_MS,
    detachedTtlMs: TERMINAL_DETACHED_TTL_MS,
  })
  const catalog = createTerminalCatalog({
    isValidClientId: isValidTerminalClientId,
    isValidTerminalId,
    manager,
    attachmentIsConnected(clientId, attachmentId) {
      return broker.attachmentIsConnected(clientId, attachmentId)
    },
    broadcastSessionsChanged(repoRoot) {
      broker.broadcastGlobal({ type: 'sessions-changed', repoRoot })
    },
    withSessionSnapshot,
  })

  const bufferedSocketByRawSocket = new WeakMap<TerminalRealtimeSocket, BufferedTerminalSocket>()
  let shuttingDown = false
  const actions = createTerminalRuntimeActions({
    manager,
    broker,
    catalog,
    isValidTerminalClientId,
    resolveAttachmentConnected,
  })

  const host: ServerTerminalHost = {
    isValidClientId(value) {
      return isValidTerminalClientId(value)
    },
    getDiagnostics() {
      return {
        mode: ptySupervisor.getDiagnostics().mode,
        state: shuttingDown ? 'shutting-down' : 'running',
        registeredSockets: broker.socketCount(),
        shuttingDown,
        pty: ptySupervisor.getDiagnostics(),
      }
    },
    registerSocket(clientId, attachmentId, socket) {
      if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId)) {
        socket.close(1008, 'invalid client id')
        return
      }
      const buffered = new BufferedTerminalSocket(socket as TerminalRealtimeSocket)
      bufferedSocketByRawSocket.set(socket as TerminalRealtimeSocket, buffered)
      broker.registerSocket(clientId, attachmentId, buffered)
    },
    unregisterSocket(clientId, attachmentId, socket) {
      const buffered = bufferedSocketByRawSocket.get(socket as TerminalRealtimeSocket) ?? (socket as TerminalRealtimeSocket)
      if (buffered instanceof BufferedTerminalSocket) buffered.deactivate()
      broker.unregisterSocket(clientId, attachmentId, buffered)
      bufferedSocketByRawSocket.delete(socket as TerminalRealtimeSocket)
    },
    async attach(clientId, input) {
      return await actions.attach(clientId, input)
    },
    async restart(clientId, input) {
      return await actions.restart(clientId, input)
    },
    write(clientId, input) {
      return actions.write(clientId, input)
    },
    resize(clientId, input) {
      return actions.resize(clientId, input)
    },
    takeover(clientId, input) {
      return actions.takeover(clientId, input)
    },
    close(clientId, input) {
      return actions.close(clientId, input)
    },
    async listSessions(clientId, repoRoot) {
      return await actions.listSessions(clientId, repoRoot)
    },
    async create(clientId, input) {
      return await actions.create(clientId, input)
    },
    async prune(clientId, repoRoot) {
      return await actions.prune(clientId, repoRoot)
    },
    getSessionSnapshot(clientId, input) {
      return actions.getSessionSnapshot(clientId, input)
    },
    reorder(clientId, input) {
      return actions.reorder(clientId, input)
    },
    handleRealtimeMessage(clientId, attachmentId, socket, payload) {
      if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId)) return
      let message: TerminalClientMessage | null = null
      try {
        message = normalizeTerminalClientMessage(JSON.parse(payload))
      } catch {
        return
      }
      if (!message) return
      const bufferedSocket = bufferedSocketByRawSocket.get(socket as TerminalRealtimeSocket)
      if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.pause()
      void handleTerminalRealtimeRequestMessage(
        realtimeHandlers,
        clientId,
        attachmentId,
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
}
