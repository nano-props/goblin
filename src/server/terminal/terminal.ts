import { isValidRepoLocator } from '#/shared/input-validation.ts'
import {
  TerminalSessionManager,
  isValidTerminalSessionId,
  isValidTerminalWriteData,
} from '#/server/terminal/terminal-session-manager.ts'
import { createTerminalCatalog } from '#/server/terminal/terminal-catalog.ts'
import { TerminalConnectionState } from '#/server/terminal/terminal-connection-state.ts'
import { TerminalRealtimeBroker, type TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
import { type TerminalCatalogMutationResult, type TerminalCreateInput } from '#/shared/terminal.ts'
import {
  isValidTerminalAttachmentId,
  isValidTerminalNotifyBellInput,
  isValidTerminalSize,
  normalizeTerminalClientMessage,
  type TerminalAttachInput,
  type TerminalAttachResult,
  type TerminalClientMessage,
  type TerminalMutationResult,
  type TerminalNotifyBellInput,
  type TerminalReorderInput,
  type TerminalResizeInput,
  type TerminalRestartInput,
  type TerminalSessionSnapshot,
  type TerminalSessionSnapshotInput,
  type TerminalSessionSummary,
  type TerminalSessionInput,
  type TerminalSocketRequestAction,
  type TerminalSocketRequestInputs,
  type TerminalSocketResponseOutputs,
  type TerminalSocketResponseMessage,
  type TerminalTakeoverInput,
  type TerminalTakeoverResult,
  type TerminalWriteInput,
} from '#/shared/terminal.ts'

const TERMINAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// Intentionally long TTL: we want terminals to survive as long as possible in
// the background so users can leave builds or long-running tasks unattended.
// 24 hours gives a full day for the user to reconnect before sessions are
// forcibly cleaned up.
const TERMINAL_DETACHED_TTL_MS = 24 * 60 * 60 * 1000
const TERMINAL_OWNERSHIP_GRACE_MS = 30_000

const manager = new TerminalSessionManager<string>({
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
    connectionState.scheduleOwnershipRelease(clientId, attachmentId, () => broker.attachmentIsConnected(clientId, attachmentId) === true)
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
const brokerSocketByRawSocket = new WeakMap<TerminalRealtimeSocket, BufferedTerminalSocket>()
type MaybePromise<T> = T | Promise<T>
type TerminalSuccessResponse<TAction extends TerminalSocketRequestAction = TerminalSocketRequestAction> = Extract<
  TerminalSocketResponseMessage,
  { type: 'response'; ok: true; action: TAction }
>
type TerminalFailureResponse = Extract<TerminalSocketResponseMessage, { type: 'response'; ok: false }>
type RealtimeRequestHandlers = {
  [TAction in TerminalSocketRequestAction]: (
    clientId: string,
    attachmentId: string,
    input: TerminalSocketRequestInputs[TAction],
  ) => MaybePromise<TerminalSocketResponseOutputs[TAction]>
}
const realtimeRequestHandlers = {
  attach(clientId, attachmentId, input) {
    return attachServerTerminal(clientId, { ...input, attachmentId })
  },
  restart(clientId, attachmentId, input) {
    return restartServerTerminal(clientId, { ...input, attachmentId })
  },
  write(clientId, attachmentId, input) {
    return writeServerTerminal(clientId, { ...input, attachmentId })
  },
  resize(clientId, attachmentId, input) {
    return resizeServerTerminal(clientId, { ...input, attachmentId })
  },
  takeover(clientId, attachmentId, input) {
    return takeoverServerTerminal(clientId, { ...input, attachmentId })
  },
  close(clientId, _attachmentId, input) {
    return closeServerTerminal(clientId, input)
  },
  'list-sessions'(clientId, _attachmentId, input) {
    return listServerTerminalSessions(clientId, input.repoRoot)
  },
  create(clientId, attachmentId, input) {
    return createServerTerminal(clientId, { ...input, attachmentId })
  },
  prune(clientId, _attachmentId, input) {
    return pruneServerTerminals(clientId, input.repoRoot)
  },
  'session-snapshot'(clientId, _attachmentId, input) {
    return getServerTerminalSessionSnapshot(clientId, input)
  },
  reorder(clientId, _attachmentId, input) {
    return reorderServerTerminals(clientId, input)
  },
} satisfies RealtimeRequestHandlers

export function registerTerminalSocket(clientId: string, attachmentId: string, socket: TerminalRealtimeSocket): void {
  if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId)) {
    socket.close(1008, 'invalid client id')
    return
  }
  const bufferedSocket = new BufferedTerminalSocket(socket)
  brokerSocketByRawSocket.set(socket, bufferedSocket)
  broker.registerSocket(clientId, attachmentId, bufferedSocket)
}

export function unregisterTerminalSocket(clientId: string, attachmentId: string, socket: TerminalRealtimeSocket): void {
  const bufferedSocket = brokerSocketByRawSocket.get(socket) ?? socket
  if (bufferedSocket instanceof BufferedTerminalSocket) bufferedSocket.deactivate()
  broker.unregisterSocket(clientId, attachmentId, bufferedSocket)
  brokerSocketByRawSocket.delete(socket)
}

export function isValidTerminalClientId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_CLIENT_ID_RE.test(value)
}

export async function attachServerTerminal(clientId: string, input: TerminalAttachInput): Promise<TerminalAttachResult> {
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
  return result.ok ? await withSessionSnapshot(result) : result
}

export async function restartServerTerminal(clientId: string, input: TerminalRestartInput): Promise<TerminalAttachResult> {
  if (
    !isValidTerminalClientId(clientId) ||
    !isValidTerminalSessionId(input?.sessionId) ||
    !isValidTerminalSize(input?.cols, input?.rows) ||
    !isValidTerminalAttachmentId(input?.attachmentId)
  ) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const result = manager.restartSession(
    clientId,
    input.sessionId,
    input.cols,
    input.rows,
    input.attachmentId,
    broker.attachmentIsConnected(clientId, input.attachmentId),
  )
  return result.ok ? await withSessionSnapshot(result) : result
}

export async function createServerTerminal(
  clientId: string,
  input: TerminalCreateInput,
): Promise<TerminalCatalogMutationResult> {
  return await catalog.create(clientId, input)
}

export async function pruneServerTerminals(
  clientId: string,
  repoRoot: string,
): Promise<{ pruned: number; remaining: number }> {
  return await catalog.prune(clientId, repoRoot)
}

export function writeServerTerminal(clientId: string, input: TerminalWriteInput): TerminalMutationResult {
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

export function resizeServerTerminal(clientId: string, input: TerminalResizeInput): TerminalMutationResult {
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

export function closeServerTerminal(clientId: string, input: TerminalSessionInput): TerminalMutationResult {
  if (!isValidTerminalClientId(clientId)) return false
  const repoRoot = isValidTerminalSessionId(input?.sessionId) ? manager.getSession(clientId, input.sessionId)?.scope : undefined
  const closed = isValidTerminalSessionId(input?.sessionId) ? manager.closeOwnedSession(clientId, input.sessionId) : false
  if (closed && repoRoot) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot })
  return closed
}

export function takeoverServerTerminal(clientId: string, input: TerminalTakeoverInput): TerminalTakeoverResult {
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

export function notifyServerTerminalBell(_clientId: string, input: TerminalNotifyBellInput): TerminalMutationResult {
  return isValidTerminalNotifyBellInput(input)
}

export async function listServerTerminalSessions(clientId: string, repoRoot: string): Promise<TerminalSessionSummary[]> {
  if (!isValidTerminalClientId(clientId)) return []
  if (!isValidRepoLocator(repoRoot)) return []
  return await manager.listSessions(repoRoot)
}

export async function getServerTerminalSessionSnapshot(
  clientId: string,
  input: TerminalSessionSnapshotInput,
): Promise<TerminalSessionSnapshot | null> {
  if (!isValidTerminalClientId(clientId)) return null
  if (!isValidTerminalSessionId(input?.sessionId)) return null
  return await manager.snapshotSession(input.sessionId)
}

export function reorderServerTerminals(clientId: string, input: TerminalReorderInput): TerminalMutationResult {
  if (!isValidTerminalClientId(clientId)) return false
  if (!isValidRepoLocator(input?.repoRoot)) return false
  if (typeof input?.worktreePath !== 'string' || input.worktreePath.length === 0) return false
  if (!Array.isArray(input?.orderedKeys)) return false
  if (!input.orderedKeys.every((k) => typeof k === 'string' && k.length > 0)) return false
  const reordered = manager.reorderSessions(input.repoRoot, input.worktreePath, input.orderedKeys)
  if (reordered) broker.broadcastGlobal({ type: 'sessions-changed', repoRoot: input.repoRoot })
  return reordered
}

export function handleRealtimeServerMessage(
  clientId: string,
  attachmentId: string,
  socket: TerminalRealtimeSocket,
  payload: string,
): void {
  if (!isValidTerminalClientId(clientId) || !isValidTerminalAttachmentId(attachmentId)) return
  let message: TerminalClientMessage | null = null
  try {
    message = normalizeTerminalClientMessage(JSON.parse(payload))
  } catch {
    return
  }
  if (!message) return
  const bufferedSocket = brokerSocketByRawSocket.get(socket)
  if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.pause()
  void handleRealtimeRequestMessage(clientId, attachmentId, socket, bufferedSocket, message)
}

export function closeAllServerTerminalSessions(): void {
  connectionState.shutdown()
  broker.disconnectAll()
  manager.closeAll()
}

async function withSessionSnapshot(
  result: Extract<TerminalAttachResult, { ok: true }>,
): Promise<Extract<TerminalAttachResult, { ok: true }>> {
  const snapshot = await manager.snapshotSession(result.sessionId)
  return snapshot ? { ...result, snapshot: snapshot.snapshot, snapshotSeq: snapshot.snapshotSeq } : result
}

function isValidTerminalId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_ID_RE.test(value)
}

function isValidTerminalSocketAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && isValidTerminalAttachmentId(value)
}

async function handleRealtimeRequestMessage(
  clientId: string,
  attachmentId: string,
  socket: TerminalRealtimeSocket,
  bufferedSocket: BufferedTerminalSocket | undefined,
  message: TerminalClientMessage,
): Promise<void> {
  let response: TerminalSuccessResponse
  try {
    response = await dispatchRealtimeRequest(clientId, attachmentId, message)
  } catch (error) {
    if (!sendRealtimeResponse(socket, buildRealtimeFailureResponse(message.requestId, message.action, error))) {
      bufferedSocket?.deactivate()
    }
    if (shouldPauseRealtimeRequest(message.action)) bufferedSocket?.resume()
    return
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

function buildRealtimeFailureResponse(
  requestId: string,
  action: TerminalSocketRequestAction,
  error: unknown,
): TerminalFailureResponse {
  return {
    type: 'response',
    requestId,
    ok: false,
    action,
    error: error instanceof Error ? error.message : String(error),
  } as TerminalFailureResponse
}

function buildRealtimeSuccessResponse<TAction extends TerminalSocketRequestAction>(
  requestId: string,
  action: TAction,
  payload: TerminalSocketResponseOutputs[TAction],
): TerminalSuccessResponse<TAction> {
  return {
    type: 'response',
    requestId,
    ok: true,
    action,
    payload,
  } as TerminalSuccessResponse<TAction>
}

async function dispatchRealtimeRequest(
  clientId: string,
  attachmentId: string,
  message: TerminalClientMessage,
): Promise<TerminalSuccessResponse> {
  return await dispatchRealtimeRequestForAction(clientId, attachmentId, message as never)
}

async function dispatchRealtimeRequestForAction<TAction extends TerminalSocketRequestAction>(
  clientId: string,
  attachmentId: string,
  message: Extract<TerminalClientMessage, { action: TAction }>,
): Promise<TerminalSuccessResponse<TAction>> {
  const handler = realtimeRequestHandlers[message.action] as RealtimeRequestHandlers[TAction]
  const payload = await handler(clientId, attachmentId, message.input as TerminalSocketRequestInputs[TAction])
  return buildRealtimeSuccessResponse(message.requestId, message.action, payload)
}

function shouldPauseRealtimeRequest(action: TerminalSocketRequestAction): boolean {
  return action === 'attach' || action === 'restart'
}

class BufferedTerminalSocket implements TerminalRealtimeSocket {
  private paused = 0
  private active = true
  private readonly buffer: Array<{ type: 'send'; payload: string } | { type: 'close'; code?: number; reason?: string }> = []

  private readonly socket: TerminalRealtimeSocket
  constructor(socket: TerminalRealtimeSocket) {
    this.socket = socket
  }

  send(payload: string): void {
    if (!this.active) return
    if (this.paused > 0) {
      this.buffer.push({ type: 'send', payload })
      return
    }
    this.sendNow(payload)
  }

  close(code?: number, reason?: string): void {
    if (!this.active) return
    if (this.paused > 0) {
      this.buffer.push({ type: 'close', code, reason })
      return
    }
    this.closeNow(code, reason)
  }

  pause(): void {
    if (!this.active) return
    this.paused += 1
  }

  resume(): void {
    if (this.paused === 0 || !this.active) return
    this.paused -= 1
    if (this.paused > 0) return
    this.flushBuffer()
  }

  deactivate(): void {
    this.active = false
    this.paused = 0
    this.buffer.length = 0
  }

  private sendNow(payload: string): void {
    try {
      this.socket.send(payload)
    } catch {
      this.deactivate()
    }
  }

  private closeNow(code?: number, reason?: string): void {
    this.active = false
    this.buffer.length = 0
    try {
      this.socket.close(code, reason)
    } catch {}
  }

  private flushBuffer(): void {
    for (const entry of this.buffer.splice(0)) {
      if (!this.active) break
      if (entry.type === 'send') {
        this.sendNow(entry.payload)
        continue
      }
      this.closeNow(entry.code, entry.reason)
      break
    }
  }
}
