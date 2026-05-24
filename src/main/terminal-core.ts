import { BrowserWindow, app } from 'electron'
import crypto from 'node:crypto'
import path from 'node:path'
import * as pty from 'node-pty'
import type { TerminalExitEvent, TerminalOpenResult, TerminalOutputEvent } from '#/shared/terminal.ts'

// Replay is intentionally capped per live session, not globally. Sessions are
// owner/worktree scoped, pruned when worktrees disappear, closed with their
// renderer owner, and removed on PTY exit; adding a global budget would need a
// user-visible eviction policy for active terminals. If background/persistent
// terminals are added later, revisit this with an explicit LRU/TTL design.
const MAX_SESSION_BUFFER_CHARS = 16 * 1024 * 1024
const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const MIN_COLS = 1
const MAX_COLS = 500
const MIN_ROWS = 1
const MAX_ROWS = 300

export interface TerminalOpenSessionInput {
  ownerWebContentsId: number
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  forceNew?: boolean
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
  sequence: number
}

const sessionsById = new Map<string, TerminalSession>()
const sessionIdByOwnerKey = new Map<string, string>()

export function openTerminalSession(input: TerminalOpenSessionInput): TerminalOpenResult {
  const size = normalizeSize(input.cols, input.rows)
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
    sequence: 0,
  }
  sessionsById.set(id, session)
  sessionIdByOwnerKey.set(ownerKey, id)

  try {
    const shell = process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/zsh')
    const args = process.platform === 'win32' ? [] : ['-l']
    const env = { ...process.env, TERM: 'xterm-256color' }
    session.pty = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env,
    })
  } catch (err) {
    closeTerminalSession(id)
    return { ok: false, message: err instanceof Error ? err.message : 'error.unknown' }
  }

  session.disposables.push(
    session.pty.onData((data) => {
      const seq = appendSessionData(session, data)
      broadcastTerminalOutput({ sessionId: session.id, data, seq })
    }),
  )
  session.disposables.push(
    session.pty.onExit(() => {
      session.pty = null
      disposeSessionListeners(session)
      // Exit IPC is a renderer UI hint for dismissing the terminal pane; main
      // still tears down the session immediately, so missed delivery only leaves
      // stale renderer chrome while subsequent writes/resizes no-op.
      broadcastTerminalExit({ sessionId: session.id })
      closeTerminalSession(session.id)
    }),
  )

  return { ok: true, sessionId: id, replay: session.buffer, replaySeq: session.sequence }
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
  const size = normalizeSize(cols, rows)
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
    if (session.key === key) closeTerminalSession(session.id)
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
    if (session.ownerWebContentsId === ownerWebContentsId && session.scope === scope && !liveKeys.has(session.key)) {
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
    session.buffer = session.buffer.slice(session.buffer.length - MAX_SESSION_BUFFER_CHARS)
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
  session.cols = cols
  session.rows = rows
  try {
    session.pty.resize(cols, rows)
    return true
  } catch (err) {
    console.warn('[terminal] failed to resize PTY', err)
    return false
  }
}

function normalizeSize(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  if (typeof cols !== 'number' || typeof rows !== 'number' || !Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null
  }
  const c = Math.floor(cols)
  const r = Math.floor(rows)
  if (c < MIN_COLS || c > MAX_COLS || r < MIN_ROWS || r > MAX_ROWS) return null
  return { cols: c, rows: r }
}

function createSessionId(): string {
  return `term_${crypto.randomUUID()}`
}

function sessionOwnerKey(ownerWebContentsId: number, key: string): string {
  return `${ownerWebContentsId}\0${key}`
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
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === ownerWebContentsId)
  if (win) sendToWindow(win, channel, event)
}

function sendToWindow(win: BrowserWindow, channel: string, event: TerminalOutputEvent | TerminalExitEvent): void {
  try {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, event)
  } catch (err) {
    console.warn('[terminal] failed to send terminal event', err)
  }
}
