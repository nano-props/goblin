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
import { createWorkspacePaneRuntime } from '#/server/workspace-pane/workspace-pane-runtime.ts'
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
  isValidTerminalSocketAttachmentId,
} from '#/server/terminal/terminal-runtime-support.ts'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { type ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { GoblinTerminalCommandRuntime } from '#/server/terminal/g-command.ts'

// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up.
const TERMINAL_DETACHED_TTL_MS = 24 * 60 * 60 * 1000
const TERMINAL_OWNERSHIP_GRACE_MS = 30_000
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
  const workspacePane = createWorkspacePaneRuntime<string>()

  // Sink callbacks fan out to every clientId that shares the
  // session's ownerId. The manager passes `ownerId` (a string
  // derived from the access token) rather than `clientId`, so a
  // live output event reaches a sibling tab (different `clientId`,
  // same `ownerId`) without an extra attach roundtrip. See
  // `identity.ts` for the model.
  const manager = new TerminalSessionManager<string>(
    ptySupervisor,
    {
      onOutput(ownerId, event) {
        broker.broadcastToOwner(ownerId, { type: 'output', event })
      },
      onTitle(ownerId, event) {
        broker.broadcastToOwner(ownerId, { type: 'title', event })
      },
      onExit(ownerId, event) {
        const repoRoot = manager.getSession(ownerId, event.sessionId)?.scope
        broker.broadcastToOwner(ownerId, { type: 'exit', event })
        if (repoRoot) broadcastRepoWorkspacePaneChanged(ownerId, repoRoot)
      },
      onOwnership(ownerId, event) {
        broker.broadcastToOwner(ownerId, { type: 'ownership', event })
      },
    },
    workspacePane,
  )
  const { broker, connectionState } = createTerminalRuntimeCoordinator({
    manager,
    workspacePane,
    ownershipGraceMs: TERMINAL_OWNERSHIP_GRACE_MS,
    detachedTtlMs: TERMINAL_DETACHED_TTL_MS,
  })
  const catalog = createTerminalCatalog({
    isValidClientId: isValidTerminalClientId,
    isValidTerminalId,
    manager,
    workspacePane,
    isAttachmentConnected(ownerId, attachmentId) {
      return broker.isAttachmentConnected(ownerId, attachmentId)
    },
    broadcastSessionsChanged(ownerId, repoRoot) {
      broadcastRepoWorkspacePaneChanged(ownerId, repoRoot)
    },
    gCommand: options.gCommand,
  })

  const bufferedSocketByRawSocket = new WeakMap<TerminalRealtimeSocket, BufferedTerminalSocket>()
  let shuttingDown = false
  const actions = createTerminalRuntimeActions({
    manager,
    workspacePane,
    broker,
    catalog,
    isValidTerminalClientId,
    // The previous stub returned `true` whenever an attachmentId
    // was present (see `resolveAttachmentConnected` before this
    // plan), which made the takeover path "work" for the first
    // browser tab but masked the fact that we never asked the
    // broker. Replacing with the broker check ensures a takeover
    // request from a brand-new tab (the cross-browser scenario)
    // only counts the attachment as connected if the WS is
    // actually alive for the (ownerId, attachmentId) pair.
    resolveAttachmentConnected(ownerId, attachmentId) {
      return broker.isAttachmentConnected(ownerId, attachmentId) ?? false
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
    registerSocket(clientId, attachmentId, ownerId, socket) {
      if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId) || !ownerId) {
        socket.close(1008, 'invalid client id')
        return
      }
      const buffered = new BufferedTerminalSocket(socket as TerminalRealtimeSocket)
      bufferedSocketByRawSocket.set(socket as TerminalRealtimeSocket, buffered)
      broker.registerSocket(clientId, attachmentId, ownerId, buffered)
    },
    unregisterSocket(_clientId, _attachmentId, _ownerId, socket) {
      const buffered =
        bufferedSocketByRawSocket.get(socket as TerminalRealtimeSocket) ?? (socket as TerminalRealtimeSocket)
      if (buffered instanceof BufferedTerminalSocket) buffered.deactivate()
      broker.unregisterSocket(buffered)
      bufferedSocketByRawSocket.delete(socket as TerminalRealtimeSocket)
    },
    async attach(clientId, ownerId, input) {
      return await actions.attach(clientId, ownerId, input)
    },
    async restart(clientId, ownerId, input) {
      return await actions.restart(clientId, ownerId, input)
    },
    write(clientId, ownerId, input) {
      return actions.write(clientId, ownerId, input)
    },
    resize(clientId, ownerId, input) {
      return actions.resize(clientId, ownerId, input)
    },
    takeover(clientId, ownerId, input) {
      return actions.takeover(clientId, ownerId, input)
    },
    close(clientId, ownerId, input) {
      return actions.close(clientId, ownerId, input)
    },
    async listSessions(clientId, ownerId, repoRoot) {
      return await actions.listSessions(clientId, ownerId, repoRoot)
    },
    listViews(clientId, ownerId, repoRoot) {
      return actions.listViews(clientId, ownerId, repoRoot)
    },
    openView(clientId, ownerId, input) {
      return actions.openView(clientId, ownerId, input)
    },
    closeView(clientId, ownerId, input) {
      return actions.closeView(clientId, ownerId, input)
    },
    async create(clientId, ownerId, input) {
      return await actions.create(clientId, ownerId, input)
    },
    async prune(clientId, ownerId, repoRoot) {
      return await actions.prune(clientId, ownerId, repoRoot)
    },
    getSessionSnapshot(clientId, ownerId, input) {
      return actions.getSessionSnapshot(clientId, ownerId, input)
    },
    reorderViews(clientId, ownerId, input) {
      return actions.reorderViews(clientId, ownerId, input)
    },
    handleRealtimeMessage(clientId, attachmentId, ownerId, socket, payload) {
      // Log invalid identifier/parse drops so a stuck takeover
      // (e.g. an old clientId pattern that the WS validator
      // missed) is observable in production logs. We still
      // return early without rejecting the WS — the message is
      // just unprocessable for this socket.
      if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId)) {
        terminalRuntimeLogger.warn({ clientId, attachmentId }, 'invalid realtime message: missing/invalid identifiers')
        return
      }
      if (!ownerId) {
        terminalRuntimeLogger.warn(
          { clientId, attachmentId },
          'invalid realtime message: missing ownerId from auth context',
        )
        return
      }
      let message: TerminalClientMessage | null = null
      try {
        message = normalizeTerminalClientMessage(JSON.parse(payload))
      } catch (err) {
        terminalRuntimeLogger.warn({ clientId, attachmentId, err }, 'invalid realtime message: parse/normalize failed')
        return
      }
      if (!message) {
        terminalRuntimeLogger.warn({ clientId, attachmentId }, 'invalid realtime message: null after normalize')
        return
      }
      const bufferedSocket = bufferedSocketByRawSocket.get(socket as TerminalRealtimeSocket)
      if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.pause()
      void handleTerminalRealtimeRequestMessage(
        realtimeHandlers,
        clientId,
        attachmentId,
        ownerId,
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

  function broadcastRepoWorkspacePaneChanged(ownerId: string, repoRoot: string): void {
    broker.broadcastToOwner(ownerId, { type: 'sessions-changed', repoRoot })
    broker.broadcastToOwner(ownerId, { type: 'workspace-pane-changed', repoRoot })
  }
}
