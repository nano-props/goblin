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

import path from 'node:path'
import { isValidRepoLocator } from '#/shared/input-validation.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { terminalSessionScope } from '#/shared/terminal-session-key.ts'
import { BufferedTerminalSocket } from '#/server/terminal/buffered-terminal-socket.ts'
import {
  type TerminalAttachInput,
  type TerminalAttachResult,
  type TerminalCatalogMutationResult,
  type TerminalCreateInput,
  isValidTerminalAttachmentId,
  isValidTerminalSize,
  normalizeTerminalClientMessage,
  type TerminalClientMessage,
  type TerminalMutationResult,
  type TerminalReorderInput,
  type TerminalRestartInput,
  type TerminalResizeInput,
  type TerminalSessionInput,
  type TerminalSessionSnapshot,
  type TerminalSessionSnapshotInput,
  type TerminalSessionSummary,
  type TerminalSocketRequestAction,
  type TerminalSocketRequestInputs,
  type TerminalSocketResponseMessage,
  type TerminalSocketResponseOutputs,
  type TerminalTakeoverInput,
  type TerminalTakeoverResult,
  type TerminalWriteInput,
} from '#/shared/terminal.ts'
import { serverLogger } from '#/server/logger.ts'
import { createTerminalCatalog } from '#/server/terminal/terminal-catalog.ts'
import { TerminalConnectionState } from '#/server/terminal/terminal-connection-state.ts'
import { TerminalRealtimeBroker, type TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
import {
  isValidTerminalSessionId,
  isValidTerminalWriteData,
  TerminalSessionManager,
} from '#/server/terminal/terminal-session-manager.ts'
import { type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { type ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

const TERMINAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
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
  const connectionState = new TerminalConnectionState({
    ownershipGraceMs: TERMINAL_OWNERSHIP_GRACE_MS,
    detachedTtlMs: TERMINAL_DETACHED_TTL_MS,
    onOwnershipRelease(clientId, attachmentId) {
      manager.releaseAttachmentControl(clientId, attachmentId)
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

  type MaybePromise<T> = T | Promise<T>

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
      return await attachServerTerminal(clientId, input)
    },
    async restart(clientId, input) {
      return await restartServerTerminal(clientId, input)
    },
    write(clientId, input) {
      return writeServerTerminal(clientId, input)
    },
    resize(clientId, input) {
      return resizeServerTerminal(clientId, input)
    },
    takeover(clientId, input) {
      return takeoverServerTerminal(clientId, input)
    },
    close(clientId, input) {
      return closeServerTerminal(clientId, input)
    },
    async listSessions(clientId, repoRoot) {
      return await listServerTerminalSessions(clientId, repoRoot)
    },
    async create(clientId, input) {
      return await createServerTerminal(clientId, input)
    },
    async prune(clientId, repoRoot) {
      return await pruneServerTerminals(clientId, repoRoot)
    },
    getSessionSnapshot(clientId, input) {
      return getServerTerminalSessionSnapshot(clientId, input)
    },
    reorder(clientId, input) {
      return reorderServerTerminals(clientId, input)
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
      void handleRealtimeRequestMessage(clientId, attachmentId, socket as TerminalRealtimeSocket, bufferedSocket, message)
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

  async function attachServerTerminal(clientId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
    if (
      !isValidTerminalClientId(clientId) ||
      !isValidTerminalSessionId(input?.sessionId) ||
      !isValidTerminalSize(input?.cols, input?.rows) ||
      !isValidTerminalAttachmentId(input?.attachmentId)
    ) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    const result = manager.attachSession(
      clientId,
      input.sessionId,
      input.cols,
      input.rows,
      input.attachmentId,
      broker.attachmentIsConnected(clientId, input.attachmentId),
    )
    return result.ok ? withSessionSnapshot(result) : result
  }

  async function restartServerTerminal(clientId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
    if (
      !isValidTerminalClientId(clientId) ||
      !isValidTerminalSessionId(input?.sessionId) ||
      !isValidTerminalSize(input?.cols, input?.rows) ||
      !isValidTerminalAttachmentId(input?.attachmentId)
    ) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    const result = await manager.restartSession(
      clientId,
      input.sessionId,
      input.cols,
      input.rows,
      input.attachmentId,
      broker.attachmentIsConnected(clientId, input.attachmentId),
    )
    return result.ok ? withSessionSnapshot(result) : result
  }

  async function createServerTerminal(
    clientId: string,
    input: TerminalCreateInput,
  ): Promise<TerminalCatalogMutationResult> {
    return await catalog.create(clientId, input)
  }

  async function pruneServerTerminals(
    clientId: string,
    repoRoot: string,
  ): Promise<{ pruned: number; remaining: number }> {
    return await catalog.prune(clientId, repoRoot)
  }

  function writeServerTerminal(clientId: string, input: TerminalWriteInput): TerminalMutationResult {
    if (!isValidTerminalClientId(clientId)) return false
    if (
      !isValidTerminalSessionId(input?.sessionId) ||
      !isValidTerminalWriteData(input?.data) ||
      !isValidTerminalAttachmentId(input?.attachmentId)
    ) {
      return false
    }
    return manager.writeSession(clientId, input.sessionId, input.data, input.attachmentId)
  }

  function resizeServerTerminal(clientId: string, input: TerminalResizeInput): TerminalMutationResult {
    if (!isValidTerminalClientId(clientId)) return false
    if (
      !isValidTerminalSessionId(input?.sessionId) ||
      !isValidTerminalSize(input?.cols, input?.rows) ||
      !isValidTerminalAttachmentId(input?.attachmentId)
    ) {
      return false
    }
    return manager.resizeSession(
      clientId,
      input.sessionId,
      input.cols,
      input.rows,
      input.attachmentId,
      broker.attachmentIsConnected(clientId, input.attachmentId),
    )
  }

  function closeServerTerminal(clientId: string, input: TerminalSessionInput): TerminalMutationResult {
    if (!isValidTerminalClientId(clientId)) return false
    const repoRoot = isValidTerminalSessionId(input?.sessionId)
      ? manager.getSession(clientId, input.sessionId)?.scope
      : undefined
    const closed = isValidTerminalSessionId(input?.sessionId)
      ? manager.closeOwnedSession(clientId, input.sessionId)
      : false
    if (closed && repoRoot) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot })
    return closed
  }

  function takeoverServerTerminal(clientId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
    if (!isValidTerminalClientId(clientId)) return { ok: false, message: 'error.invalid-arguments' }
    if (
      !isValidTerminalSessionId(input?.sessionId) ||
      !isValidTerminalSize(input?.cols, input?.rows) ||
      !isValidTerminalAttachmentId(input?.attachmentId)
    ) {
      return { ok: false, message: 'error.invalid-arguments' }
    }
    return manager.takeoverSession(
      clientId,
      input.sessionId,
      input.cols,
      input.rows,
      input.attachmentId,
      broker.attachmentIsConnected(clientId, input.attachmentId),
    )
  }

  async function listServerTerminalSessions(
    clientId: string,
    repoRoot: string,
  ): Promise<TerminalSessionSummary[]> {
    if (!isValidTerminalClientId(clientId)) return []
    if (!isValidRepoLocator(repoRoot)) return []
    return await catalog.listSessions(repoRoot)
  }

  function getServerTerminalSessionSnapshot(
    clientId: string,
    input: TerminalSessionSnapshotInput,
  ): TerminalSessionSnapshot | null {
    if (!isValidTerminalClientId(clientId)) return null
    if (!isValidTerminalSessionId(input?.sessionId)) return null
    return manager.snapshotSession(input.sessionId)
  }

  function reorderServerTerminals(clientId: string, input: TerminalReorderInput): TerminalMutationResult {
    if (!isValidTerminalClientId(clientId)) return false
    if (!isValidRepoLocator(input?.repoRoot)) return false
    if (typeof input?.worktreePath !== 'string' || input.worktreePath.length === 0) return false
    if (!Array.isArray(input?.orderedKeys)) return false
    if (!input.orderedKeys.every((k) => typeof k === 'string' && k.length > 0)) return false
    // Normalize the scope/worktreePath the same way the catalog does, so
    // manager.reorderSessions sees the canonical forms it stored on
    // each session. Without this, Windows forward-slash paths never
    // match the resolved back-slash form and the reorder silently
    // no-ops.
    const scope = terminalSessionScope(input.repoRoot)
    const worktreePath = isRemoteRepoId(input.repoRoot) ? input.worktreePath : path.resolve(input.worktreePath)
    const reordered = manager.reorderSessions(scope, worktreePath, input.orderedKeys)
    if (reordered) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot: input.repoRoot })
    return reordered
  }

  // Action → handler table. The handler receives the union-shaped input
  // and the WS request's `clientId`/`attachmentId` (the latter is used
  // by handlers that need to merge it into the input — see `create`).
  const REALTIME_HANDLERS: {
    [TAction in TerminalSocketRequestAction]: (
      clientId: string,
      attachmentId: string,
      input: TerminalSocketRequestInputs[TAction],
    ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
  } = {
    attach(clientId, _attachmentId, input) {
      return host.attach(clientId, input)
    },
    restart(clientId, _attachmentId, input) {
      return host.restart(clientId, input)
    },
    write(clientId, _attachmentId, input) {
      return host.write(clientId, input)
    },
    resize(clientId, _attachmentId, input) {
      return host.resize(clientId, input)
    },
    takeover(clientId, _attachmentId, input) {
      return host.takeover(clientId, input)
    },
    close(clientId, _attachmentId, input) {
      return host.close(clientId, input)
    },
    'list-sessions'(clientId, _attachmentId, input) {
      return host.listSessions(clientId, input.repoRoot)
    },
    create(clientId, attachmentId, input) {
      return host.create(clientId, { ...input, attachmentId })
    },
    prune(clientId, _attachmentId, input) {
      return host.prune(clientId, input.repoRoot)
    },
    'session-snapshot'(clientId, _attachmentId, input) {
      return host.getSessionSnapshot(clientId, input)
    },
    reorder(clientId, _attachmentId, input) {
      return host.reorder(clientId, input)
    },
  }

  async function handleRealtimeRequestMessage(
    clientId: string,
    attachmentId: string,
    socket: TerminalRealtimeSocket,
    bufferedSocket: BufferedTerminalSocket | undefined,
    message: TerminalClientMessage,
  ): Promise<void> {
    let response: TerminalSocketResponseMessage
    try {
      const handler = REALTIME_HANDLERS[message.action] as (
        clientId: string,
        attachmentId: string,
        input: TerminalSocketRequestInputs[typeof message.action],
      ) => MaybePromise<TerminalSocketResponseOutputs[typeof message.action]>
      const payload = await handler(clientId, attachmentId, message.input)
      response = {
        type: 'response',
        requestId: message.requestId,
        ok: true,
        action: message.action,
        payload,
      } as TerminalSocketResponseMessage
    } catch (error) {
      response = {
        type: 'response',
        requestId: message.requestId,
        ok: false,
        action: message.action,
        error: error instanceof Error ? error.message : String(error),
      } as TerminalSocketResponseMessage
    }
    if (!sendRealtimeResponse(socket, response)) {
      bufferedSocket?.deactivate()
    }
    if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.resume()
  }

  function sendRealtimeResponse(socket: TerminalRealtimeSocket, message: TerminalSocketResponseMessage): boolean {
    try {
      socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  // Pause the buffered socket while an action's response is being prepared
  // when the action's response may carry a replay buffer. Without this, the
  // live `output` events that arrive between the request and the response
  // would stream to the client before the replay, leaving the snapshot
  // applied twice (once from the response, once from the queued output).
  //
  // The set is exactly the actions whose response shape includes a
  // `replay` field: `attach` and `restart`. `session-snapshot` returns
  // a `{ sessionId, snapshot, snapshotSeq }` payload that looks
  // similar but is deliberately **excluded** — the snapshot is
  // consumed later by `ManagedTerminalSession.preloadHydratedSnapshot`,
  // long after the realtime round-trip, and the renderer has no live
  // xterm to apply queued `output` events to in the meantime. Pausing
  // here would needlessly buffer events that get dropped anyway.
  function shouldPauseRealtimeRequest(action: TerminalSocketRequestAction): boolean {
    return action === 'attach' || action === 'restart'
  }

  // The buffer-based replay is itself the canonical snapshot — the
  // client writes it verbatim into its xterm and ends up in the same
  // state. We mirror the buffer into the snapshot fields so the
  // client's existing snapshot-first path picks it up without a code
  // change.
  function withSessionSnapshot(
    result: Extract<TerminalAttachResult, { ok: true }>,
  ): Extract<TerminalAttachResult, { ok: true }> {
    return {
      ...result,
      snapshot: result.replay,
      snapshotSeq: result.replaySeq,
    }
  }

  function isValidTerminalClientId(value: unknown): value is string {
    return typeof value === 'string' && TERMINAL_CLIENT_ID_RE.test(value)
  }

  function isValidTerminalId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
  }

  function isValidTerminalSocketAttachmentId(value: unknown): value is string {
    return typeof value === 'string' && isValidTerminalAttachmentId(value)
  }

  terminalRuntimeLogger.info({ ptyMode: ptySupervisor.getDiagnostics().mode }, 'server terminal runtime created')

  return {
    host,
    shutdown() {
      host.shutdown()
    },
  }
}
