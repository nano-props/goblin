import { BrowserWindow, app } from 'electron'
import crypto from 'node:crypto'
import path from 'node:path'
import * as pty from 'node-pty'
import {
  normalizeTerminalSize,
  type TerminalExitEvent,
  type TerminalOpenResult,
  type TerminalOutputEvent,
} from '#/shared/terminal.ts'

// Replay is intentionally capped per live session, not globally. Sessions are
// owner/worktree scoped, pruned when worktrees disappear, closed with their
// renderer owner, and removed on PTY exit; adding a global budget would need a
// user-visible eviction policy for active terminals. If background/persistent
// terminals are added later, revisit this with an explicit LRU/TTL design.
const MAX_SESSION_BUFFER_CHARS = 16 * 1024 * 1024
const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/

export interface TerminalOpenSessionInput {
  ownerWebContentsId: number
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  forceNew?: boolean
  command?: string
  args?: string[]
}

interface TerminalSession {
  id: string
  ownerWebContentsId: number
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  pty: pty.IPty | null
  disposables: Array<{ dispose: () => void }>
  buffer: string
  bufferTruncated: boolean
  sequence: number
  processName: string
}

const sessionsById = new Map<string, TerminalSession>()
const sessionIdByOwnerKey = new Map<string, string>()

export function openTerminalSession(input: TerminalOpenSessionInput): TerminalOpenResult {
  const size = normalizeTerminalSize(input.cols, input.rows)
  if (!size) return { ok: false, message: 'error.invalid-arguments' }

  const cwd = path.resolve(input.cwd)
  const ownerWebContentsId = input.ownerWebContentsId
  if (!isValidOwnerWebContentsId(ownerWebContentsId)) return { ok: false, message: 'error.invalid-arguments' }
  const key = input.key
  const ownerKey = sessionOwnerKey(ownerWebContentsId, key)
  if (input.forceNew) closeTerminalOwnerKey(ownerWebContentsId, key)
  const existingId = sessionIdByOwnerKey.get(ownerKey)
  const existing = existingId ? sessionsById.get(existingId) : undefined
  if (existing) {
    resizeSessionPty(existing, size.cols, size.rows)
    return {
      ok: true,
      sessionId: existing.id,
      replay: existing.buffer,
      replaySeq: existing.sequence,
      replayTruncated: existing.bufferTruncated,
      processName: existing.processName,
    }
  }

  const id = createSessionId()
  const session: TerminalSession = {
    id,
    ownerWebContentsId,
    scope: input.scope,
    key,
    cwd,
    cols: size.cols,
    rows: size.rows,
    pty: null,
    disposables: [],
    buffer: '',
    bufferTruncated: false,
    sequence: 0,
    processName: '',
  }
  sessionsById.set(id, session)
  sessionIdByOwnerKey.set(ownerKey, id)

  try {
    const shell = input.command || process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/zsh')
    const args = input.args ?? (process.platform === 'win32' ? [] : ['-l'])
    const env = { ...process.env, TERM: 'xterm-256color' }
    session.pty = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env,
    })
    session.processName = terminalProcessName(session.pty)
  } catch (err) {
    closeTerminalSession(id)
    return { ok: false, message: err instanceof Error ? err.message : 'error.unknown' }
  }

  session.disposables.push(
    session.pty.onData((data) => {
      const seq = appendSessionData(session, data)
      const processName = terminalProcessName(session.pty)
      session.processName = processName
      broadcastTerminalOutput({ sessionId: session.id, data, seq, processName })
    }),
  )
  session.disposables.push(
    session.pty.onExit(() => {
      session.pty = null
      // Exit IPC is a renderer UI hint for dismissing the terminal pane; main
      // still tears down the session immediately, so missed delivery only leaves
      // stale renderer chrome while subsequent writes/resizes no-op.
      broadcastTerminalExit({ sessionId: session.id })
      closeTerminalSession(session.id)
    }),
  )

  return {
    ok: true,
    sessionId: id,
    replay: session.buffer,
    replaySeq: session.sequence,
    replayTruncated: session.bufferTruncated,
    processName: session.processName,
  }
}

export function writeTerminalSession(ownerWebContentsId: number, sessionId: string, data: string): boolean {
  if (!isValidTerminalSessionId(sessionId) || !isValidTerminalWriteData(data)) return false
  const session = ownedSession(ownerWebContentsId, sessionId)
  if (!session?.pty) return false
  try {
    session.pty.write(data)
    return true
  } catch (err) {
    console.warn('[terminal] failed to write PTY', err)
    return false
  }
}

export function resizeTerminalSession(
  ownerWebContentsId: number,
  sessionId: string,
  cols: number,
  rows: number,
): boolean {
  if (!isValidTerminalSessionId(sessionId)) return false
  const size = normalizeTerminalSize(cols, rows)
  if (!size) return false
  const session = ownedSession(ownerWebContentsId, sessionId)
  return session ? resizeSessionPty(session, size.cols, size.rows) : false
}

export function closeOwnedTerminalSession(ownerWebContentsId: number, sessionId: string): boolean {
  if (!ownedSession(ownerWebContentsId, sessionId)) return false
  closeTerminalSession(sessionId)
  return true
}

export function closeTerminalSession(sessionId: string): void {
  const session = sessionsById.get(sessionId)
  if (!session) return
  sessionsById.delete(sessionId)
  const ownerKey = sessionOwnerKey(session.ownerWebContentsId, session.key)
  if (sessionIdByOwnerKey.get(ownerKey) === sessionId) sessionIdByOwnerKey.delete(ownerKey)
  disposeSessionListeners(session)
  if (session.pty) {
    try {
      session.pty.kill()
    } catch (err) {
      console.warn('[terminal] failed to kill PTY', err)
    }
  }
  session.pty = null
}

export function closeTerminalKey(key: string): void {
  for (const session of Array.from(sessionsById.values())) {
    if (session.key === key || session.key.startsWith(`${key}\0`)) closeTerminalSession(session.id)
  }
}

export function closeTerminalOwner(ownerWebContentsId: number): void {
  for (const session of Array.from(sessionsById.values())) {
    if (session.ownerWebContentsId === ownerWebContentsId) closeTerminalSession(session.id)
  }
}

function closeTerminalOwnerKey(ownerWebContentsId: number, key: string): void {
  const id = sessionIdByOwnerKey.get(sessionOwnerKey(ownerWebContentsId, key))
  if (id) closeTerminalSession(id)
}

export function pruneTerminalScope(ownerWebContentsId: number, scope: string, liveKeys: Set<string>): void {
  for (const session of Array.from(sessionsById.values())) {
    const key = terminalPruneKey(session.key)
    if (session.ownerWebContentsId === ownerWebContentsId && session.scope === scope && !liveKeys.has(key)) {
      closeTerminalSession(session.id)
    }
  }
}

export function closeAllTerminalSessions(): void {
  for (const sessionId of Array.from(sessionsById.keys())) closeTerminalSession(sessionId)
}

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export function isValidTerminalWriteData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TERMINAL_WRITE_CHARS
}

export function wireTerminalSessionCleanup(): void {
  app.on('will-quit', closeAllTerminalSessions)
  app.on('before-quit', closeAllTerminalSessions)
}

function appendSessionData(session: TerminalSession, data: string): number {
  session.sequence += 1
  session.buffer += data
  if (session.buffer.length > MAX_SESSION_BUFFER_CHARS) {
    session.buffer = safeReplayTail(session.buffer, MAX_SESSION_BUFFER_CHARS)
    session.bufferTruncated = true
  }
  return session.sequence
}

function ownedSession(ownerWebContentsId: number, sessionId: string): TerminalSession | undefined {
  if (!isValidOwnerWebContentsId(ownerWebContentsId) || !isValidTerminalSessionId(sessionId)) return undefined
  const session = sessionsById.get(sessionId)
  return session?.ownerWebContentsId === ownerWebContentsId ? session : undefined
}

function isValidOwnerWebContentsId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function disposeSessionListeners(session: TerminalSession): void {
  for (const disposable of session.disposables.splice(0)) {
    try {
      disposable.dispose()
    } catch (err) {
      console.warn('[terminal] failed to dispose PTY listener', err)
    }
  }
}

function resizeSessionPty(session: TerminalSession, cols: number, rows: number): boolean {
  if (!session.pty) return false
  if (session.cols === cols && session.rows === rows) return true
  try {
    session.pty.resize(cols, rows)
    session.cols = cols
    session.rows = rows
    return true
  } catch (err) {
    console.warn('[terminal] failed to resize PTY', err)
    return false
  }
}

function safeReplayTail(buffer: string, maxChars: number): string {
  let tail = buffer.slice(buffer.length - maxChars)
  if (tail.length === 0) return tail
  const first = tail.charCodeAt(0)
  const second = tail.length > 1 ? tail.charCodeAt(1) : 0
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1)
  else if (first >= 0xd800 && first <= 0xdbff && !(second >= 0xdc00 && second <= 0xdfff)) tail = tail.slice(1)
  const boundary = tail.search(/[\n\r]/)
  return boundary >= 0 && boundary < tail.length - 1 ? tail.slice(boundary + 1) : tail
}

function terminalProcessName(term: pty.IPty | null): string {
  const processName = typeof term?.process === 'string' ? term.process.trim() : ''
  return processName || 'terminal'
}

function createSessionId(): string {
  return `term_${crypto.randomUUID()}`
}

function sessionOwnerKey(ownerWebContentsId: number, key: string): string {
  return `${ownerWebContentsId}\0${key}`
}

function terminalPruneKey(key: string): string {
  const parts = key.split('\0')
  return parts.length >= 2 ? `${parts[0]}\0${parts[1]}` : key
}

function broadcastTerminalOutput(event: TerminalOutputEvent): void {
  const session = sessionsById.get(event.sessionId)
  if (session) sendToOwner(session.ownerWebContentsId, 'goblin:terminal-output', event)
}

function broadcastTerminalExit(event: TerminalExitEvent): void {
  const session = sessionsById.get(event.sessionId)
  if (session) sendToOwner(session.ownerWebContentsId, 'goblin:terminal-exit', event)
}

function sendToOwner(
  ownerWebContentsId: number,
  channel: string,
  event: TerminalOutputEvent | TerminalExitEvent,
): void {
  const win = BrowserWindow.getAllWindows().find((candidate) => {
    try {
      return (
        !candidate.isDestroyed() &&
        !candidate.webContents.isDestroyed() &&
        candidate.webContents.id === ownerWebContentsId
      )
    } catch {
      return false
    }
  })
  if (win) sendToWindow(win, channel, event)
}

function sendToWindow(win: BrowserWindow, channel: string, event: TerminalOutputEvent | TerminalExitEvent): void {
  try {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, event)
  } catch (err) {
    console.warn('[terminal] failed to send terminal event', err)
  }
}
