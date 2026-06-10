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
  type TerminalAttachInput,
  type TerminalAttachResult,
  type TerminalMutationResult,
  type TerminalNotifyBellInput,
  type TerminalResizeInput,
  type TerminalRestartInput,
  type TerminalSessionSnapshot,
  type TerminalSessionSnapshotInput,
  type TerminalSessionSummary,
  type TerminalSessionInput,
  type TerminalTakeoverInput,
  type TerminalTakeoverResult,
  type TerminalWriteInput,
} from '#/shared/terminal.ts'

const TERMINAL_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TERMINAL_DETACHED_TTL_MS = 6 * 60 * 60 * 1000
const TERMINAL_OWNERSHIP_GRACE_MS = 3_000

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

export function registerTerminalSocket(clientId: string, attachmentId: string, socket: TerminalRealtimeSocket): void {
  if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId)) {
    socket.close(1008, 'invalid client id')
    return
  }
  broker.registerSocket(clientId, attachmentId, socket)
}

export function unregisterTerminalSocket(clientId: string, attachmentId: string, socket: TerminalRealtimeSocket): void {
  broker.unregisterSocket(clientId, attachmentId, socket)
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
  return await catalog.listSessions(repoRoot)
}

export async function getServerTerminalSessionSnapshot(
  clientId: string,
  input: TerminalSessionSnapshotInput,
): Promise<TerminalSessionSnapshot | null> {
  if (!isValidTerminalClientId(clientId)) return null
  if (!isValidTerminalSessionId(input?.sessionId)) return null
  return await manager.snapshotSession(input.sessionId)
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
