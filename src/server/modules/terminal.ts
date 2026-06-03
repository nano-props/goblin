import path from 'node:path'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveKnownWorktree } from '#/shared/worktree-guards.ts'
import { isValidAbsolutePath, isValidBranch, isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import {
  TerminalSessionManager,
  isValidTerminalSessionId,
  isValidTerminalWriteData,
} from '#/server/common/terminal-session-manager.ts'
import { type TerminalCatalogAction, type TerminalCatalogMutationResult, type TerminalCreateInput } from '#/shared/terminal.ts'
import { isRemoteRepoId, parseRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  isValidTerminalAttachmentId,
  isValidTerminalNotifyBellInput,
  isValidTerminalSize,
  type TerminalAttachInput,
  type TerminalAttachResult,
  type TerminalControllerStatus,
  type TerminalMutationResult,
  type TerminalNotifyBellInput,
  type TerminalRealtimeMessage,
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

interface EnsureServerTerminalInput {
  repoRoot: string
  branch: string
  worktreePath: string
  terminalId?: string
  cols?: number
  rows?: number
  attachmentId?: string
}

type EnsureServerTerminalResult =
  | {
      ok: true
      sessionId: string
      key: string
      action: TerminalCatalogAction
      replay: string
      replaySeq: number
      replayTruncated: boolean
      processName: string
      canonicalTitle: string | null
      snapshot?: string
      snapshotSeq?: number
      controller: { attachmentId: string; status: Exclude<TerminalControllerStatus, 'none'> } | null
      canonicalCols?: number
      canonicalRows?: number
    }
  | { ok: false; message: string }

interface TerminalSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

const socketsByClientId = new Map<string, Set<TerminalSocket>>()
const socketMetaBySocket = new WeakMap<TerminalSocket, { clientId: string; attachmentId: string }>()
const socketCountByAttachmentKey = new Map<string, number>()
const ownershipTimerByAttachmentKey = new Map<string, ReturnType<typeof setTimeout>>()
const disconnectTimerByClientId = new Map<string, ReturnType<typeof setTimeout>>()
const manager = new TerminalSessionManager<string>({
  onOutput(clientId, event) {
    broadcast(clientId, { type: 'output', event })
  },
  onTitle(clientId, event) {
    broadcast(clientId, { type: 'title', event })
  },
  onExit(clientId, event) {
    const repoRoot = manager.getSession(clientId, event.sessionId)?.scope
    broadcast(clientId, { type: 'exit', event })
    if (repoRoot) broadcastGlobal({ type: 'sessions-changed', repoRoot })
  },
  onOwnership(clientId, event) {
    broadcast(clientId, { type: 'ownership', event })
  },
})

export function registerTerminalSocket(clientId: string, attachmentId: string, socket: TerminalSocket): void {
  if (!isValidTerminalClientId(clientId) || !isValidTerminalSocketAttachmentId(attachmentId)) {
    socket.close(1008, 'invalid client id')
    return
  }
  clearDisconnectTimer(clientId)
  clearOwnershipTimer(clientId, attachmentId)
  let sockets = socketsByClientId.get(clientId)
  if (!sockets) {
    sockets = new Set()
    socketsByClientId.set(clientId, sockets)
  }
  sockets.add(socket)
  socketMetaBySocket.set(socket, { clientId, attachmentId })
  const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
  const nextCount = (socketCountByAttachmentKey.get(attachmentKey) ?? 0) + 1
  socketCountByAttachmentKey.set(attachmentKey, nextCount)
  if (nextCount === 1) manager.setAttachmentConnected(clientId, attachmentId, true)
}

export function unregisterTerminalSocket(clientId: string, attachmentId: string, socket: TerminalSocket): void {
  const sockets = socketsByClientId.get(clientId)
  if (!sockets?.has(socket)) return
  sockets.delete(socket)
  socketMetaBySocket.delete(socket)
  const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
  const nextCount = Math.max(0, (socketCountByAttachmentKey.get(attachmentKey) ?? 0) - 1)
  if (nextCount === 0) {
    socketCountByAttachmentKey.delete(attachmentKey)
    manager.setAttachmentConnected(clientId, attachmentId, false)
    scheduleOwnershipRelease(clientId, attachmentId)
  } else socketCountByAttachmentKey.set(attachmentKey, nextCount)
  if (sockets.size > 0) return
  socketsByClientId.delete(clientId)
  scheduleDisconnectCleanup(clientId)
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
    attachmentIsConnected(clientId, input.attachmentId),
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
    attachmentIsConnected(clientId, input.attachmentId),
  )
  return result.ok ? await withSessionSnapshot(result) : result
}

async function ensureOrRestoreServerTerminal(
  clientId: string,
  input: EnsureServerTerminalInput,
): Promise<EnsureServerTerminalResult> {
  // Validate input
  if (!isValidTerminalClientId(clientId)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidRepoLocator(input.repoRoot)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidBranch(input.branch)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidCwd(input.worktreePath)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }

  const terminalId = input.terminalId ?? 'terminal-1'
  const cols = input.cols ?? 80
  const rows = input.rows ?? 24
  const isRemote = isRemoteRepoId(input.repoRoot)

  // Validate terminal ID and size
  if (!isValidTerminalId(terminalId)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidTerminalSize(cols, rows)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  // Check if there's an existing session for this worktree
  const existingSessions = await manager.listSessions(input.repoRoot)
  const targetSessionKey = sessionKey(input.repoRoot, input.worktreePath, terminalId)
  const existingSession = existingSessions.find((s) => s.key === targetSessionKey)

  let action: TerminalCatalogAction = 'created'

  // If there's an existing session, determine whether this catalog mutation is a restore or simple reuse.
  if (existingSession) {
    if (existingSession.controller) {
      action = 'restored'
    } else {
      action = 'reused'
    }
  }

  // For remote repos, build remote invocation
  if (isRemote) {
    const ref = parseRemoteRepoId(input.repoRoot)
    if (!ref) return { ok: false, message: 'error.ssh-config-changed' }
    let resolved
    try {
      resolved = await resolveRemoteTarget(ref)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
    }
    const invocation = buildRemoteTerminalInvocation(resolved.target, input.worktreePath, { cols, rows })
    const result = manager.ensureSession({
      ownerId: clientId,
      scope: input.repoRoot,
      key: targetSessionKey,
      cwd: process.cwd(),
      cols,
      rows,
      attachmentId: input.attachmentId,
      attachmentConnected: attachmentIsConnected(clientId, input.attachmentId),
      forceNew: action === 'created',
      command: invocation.command,
      args: invocation.args,
    })
    if (result.ok) {
      broadcastGlobal({ type: 'sessions-changed', repoRoot: input.repoRoot })
      const snapshotResult = await withSessionSnapshot(result)
      return {
        ok: true,
        sessionId: result.sessionId,
        key: targetSessionKey,
        action,
        replay: snapshotResult.replay,
        replaySeq: snapshotResult.replaySeq,
        replayTruncated: snapshotResult.replayTruncated,
        processName: snapshotResult.processName,
        canonicalTitle: snapshotResult.canonicalTitle,
        snapshot: snapshotResult.snapshot,
        snapshotSeq: snapshotResult.snapshotSeq,
        controller: snapshotResult.controller,
        canonicalCols: snapshotResult.canonicalCols,
        canonicalRows: snapshotResult.canonicalRows,
      }
    }
    return { ok: false, message: result.message }
  }

  // For local repos, resolve worktree and open session
  const worktrees = await getWorktrees(input.repoRoot, { includeStatus: false })
  const resolved = resolveKnownWorktree(worktrees, input.worktreePath, input.branch)
  if (!resolved.ok) return { ok: false, message: resolved.message }

  const repoRoot = path.resolve(input.repoRoot)
  const worktreePath = path.resolve(resolved.path)
  const result = manager.ensureSession({
    ownerId: clientId,
    scope: repoRoot,
    key: targetSessionKey,
    cwd: worktreePath,
    cols,
    rows,
    attachmentId: input.attachmentId,
    attachmentConnected: attachmentIsConnected(clientId, input.attachmentId),
    forceNew: action === 'created',
  })

  if (result.ok) {
    broadcastGlobal({ type: 'sessions-changed', repoRoot: input.repoRoot })
    const snapshotResult = await withSessionSnapshot(result)
    return {
      ok: true,
      sessionId: result.sessionId,
      key: targetSessionKey,
      action,
      replay: snapshotResult.replay,
      replaySeq: snapshotResult.replaySeq,
      replayTruncated: snapshotResult.replayTruncated,
      processName: snapshotResult.processName,
      canonicalTitle: snapshotResult.canonicalTitle,
      snapshot: snapshotResult.snapshot,
      snapshotSeq: snapshotResult.snapshotSeq,
      controller: snapshotResult.controller,
      canonicalCols: snapshotResult.canonicalCols,
      canonicalRows: snapshotResult.canonicalRows,
    }
  }

  return { ok: false, message: result.message }
}

export async function createServerTerminal(
  clientId: string,
  input: TerminalCreateInput,
): Promise<TerminalCatalogMutationResult> {
  if (!isValidTerminalClientId(clientId)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidRepoLocator(input.repoRoot)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidTerminalAttachmentId(input?.attachmentId)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  const createResult = await ensureOrRestoreServerTerminal(clientId, {
    ...input,
    terminalId:
      input.kind === 'primary' ? 'terminal-1' : await nextServerTerminalId(input.repoRoot, input.worktreePath),
  })
  if (!createResult.ok) {
    return { ok: false, message: createResult.message }
  }
  return {
    ok: true,
    action: createResult.action,
    key: createResult.key,
    sessions: await manager.listSessions(input.repoRoot),
  }
}

export async function pruneServerTerminals(
  clientId: string,
  repoRoot: string,
): Promise<{ pruned: number; remaining: number }> {
  if (!isValidTerminalClientId(clientId)) {
    return { pruned: 0, remaining: 0 }
  }
  if (!isValidRepoLocator(repoRoot)) {
    return { pruned: 0, remaining: 0 }
  }

  const allSessions = await manager.listSessions(repoRoot)
  if (isRemoteRepoId(repoRoot)) {
    return { pruned: 0, remaining: allSessions.length }
  }
  const worktrees = await getWorktrees(repoRoot, { includeStatus: false })
  const liveWorktreePaths = new Set(worktrees.map((worktree) => path.resolve(worktree.path)))
  let pruned = 0
  for (const session of allSessions) {
    const parsed = parseSessionKey(session.key)
    if (!parsed) continue
    if (path.resolve(parsed.repoRoot) !== path.resolve(repoRoot)) continue
    if (liveWorktreePaths.has(path.resolve(parsed.worktreePath))) continue
    manager.closeSession(session.sessionId)
    pruned++
  }

  if (pruned > 0) {
    broadcastGlobal({ type: 'sessions-changed', repoRoot })
  }

  const remaining = await manager.listSessions(repoRoot).then((sessions) => sessions.length)
  return { pruned, remaining }
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
    attachmentIsConnected(clientId, input.attachmentId),
  )
}

export function closeServerTerminal(clientId: string, input: TerminalSessionInput): TerminalMutationResult {
  if (!isValidTerminalClientId(clientId)) return false
  // Get session info before closing to determine repoRoot
  const session = manager.getSession(clientId, input.sessionId)
  const repoRoot = session?.scope ?? '*'
  const closed = isValidTerminalSessionId(input?.sessionId) ? manager.closeOwnedSession(clientId, input.sessionId) : false
  if (closed) {
    // Broadcast session list change to all clients
    broadcastGlobal({ type: 'sessions-changed', repoRoot })
  }
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
    attachmentIsConnected(clientId, input.attachmentId),
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

export function closeAllServerTerminalSessions(): void {
  for (const key of Array.from(ownershipTimerByAttachmentKey.keys())) clearOwnershipTimerByKey(key)
  for (const clientId of Array.from(disconnectTimerByClientId.keys())) clearDisconnectTimer(clientId)
  manager.closeAll()
}

function broadcast(clientId: string, message: TerminalRealtimeMessage): void {
  const payload = JSON.stringify(message)
  const sockets = socketsByClientId.get(clientId)
  if (!sockets || sockets.size === 0) return
  for (const socket of Array.from(sockets)) {
    try {
      socket.send(payload)
    } catch {
      const meta = socketMetaBySocket.get(socket)
      if (meta) unregisterTerminalSocket(meta.clientId, meta.attachmentId, socket)
    }
  }
}

// Broadcast to all connected clients for session list changes
function broadcastGlobal(message: TerminalRealtimeMessage): void {
  const payload = JSON.stringify(message)
  for (const [clientId, sockets] of socketsByClientId.entries()) {
    for (const socket of Array.from(sockets)) {
      try {
        socket.send(payload)
      } catch {
        const meta = socketMetaBySocket.get(socket)
        if (meta) unregisterTerminalSocket(meta.clientId, meta.attachmentId, socket)
      }
    }
  }
}

function scheduleOwnershipRelease(clientId: string, attachmentId: string): void {
  clearOwnershipTimer(clientId, attachmentId)
  const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
  ownershipTimerByAttachmentKey.set(
    attachmentKey,
    setTimeout(() => {
      ownershipTimerByAttachmentKey.delete(attachmentKey)
      if ((socketCountByAttachmentKey.get(attachmentKey) ?? 0) > 0) return
      manager.releaseAttachmentControl(clientId, attachmentId)
    }, TERMINAL_OWNERSHIP_GRACE_MS),
  )
}

function scheduleDisconnectCleanup(clientId: string): void {
  clearDisconnectTimer(clientId)
  disconnectTimerByClientId.set(
    clientId,
    setTimeout(() => {
      disconnectTimerByClientId.delete(clientId)
      if ((socketsByClientId.get(clientId)?.size ?? 0) > 0) return
      manager.closeOwner(clientId)
    }, TERMINAL_DETACHED_TTL_MS),
  )
}

function attachmentIsConnected(clientId: string, attachmentId?: string): boolean | undefined {
  if (!attachmentId) return undefined
  return (socketCountByAttachmentKey.get(terminalAttachmentKey(clientId, attachmentId)) ?? 0) > 0
}

function clearDisconnectTimer(clientId: string): void {
  const timer = disconnectTimerByClientId.get(clientId)
  if (!timer) return
  clearTimeout(timer)
  disconnectTimerByClientId.delete(clientId)
}

function clearOwnershipTimer(clientId: string, attachmentId: string): void {
  clearOwnershipTimerByKey(terminalAttachmentKey(clientId, attachmentId))
}

function clearOwnershipTimerByKey(attachmentKey: string): void {
  const timer = ownershipTimerByAttachmentKey.get(attachmentKey)
  if (!timer) return
  clearTimeout(timer)
  ownershipTimerByAttachmentKey.delete(attachmentKey)
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

function sessionKey(repoRoot: string, worktreePath: string, terminalId?: string): string {
  return `${repoRoot}\0${worktreePath}\0${terminalId ?? 'terminal-1'}`
}

function parseSessionKey(key: string): { repoRoot: string; worktreePath: string; terminalId: string } | null {
  const parts = key.split('\0')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  return { repoRoot: parts[0], worktreePath: parts[1], terminalId: parts[2] }
}

function terminalAttachmentKey(clientId: string, attachmentId: string): string {
  return `${clientId}\0${attachmentId}`
}

async function nextServerTerminalId(repoRoot: string, worktreePath: string): Promise<string> {
  const sessions = await manager.listSessions(repoRoot)
  let maxIndex = 0
  for (const session of sessions) {
    const parsed = parseSessionKey(session.key)
    if (!parsed || parsed.repoRoot !== repoRoot || parsed.worktreePath !== worktreePath) continue
    const match = /^terminal-(\d+)$/.exec(parsed.terminalId)
    if (!match) continue
    const index = Number.parseInt(match[1] ?? '', 10)
    if (Number.isFinite(index) && index > maxIndex) maxIndex = index
  }
  return `terminal-${maxIndex + 1}`
}
