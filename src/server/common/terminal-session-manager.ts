import crypto from 'node:crypto'
import path from 'node:path'
import * as pty from 'node-pty'
import * as xtermHeadlessImport from '@xterm/headless'
import type { SerializeAddon as XTermSerializeAddon } from '@xterm/addon-serialize'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  cloneTerminalController,
  normalizeTerminalSize,
  type TerminalAttachResult,
  type TerminalController,
  type TerminalControllerStatus,
  type TerminalExitEvent,
  type TerminalOwnershipEvent,
  type TerminalOutputEvent,
  type TerminalSessionSnapshot,
  type TerminalSessionSummary,
  type TerminalTakeoverResult,
} from '#/shared/terminal.ts'

const MAX_SESSION_BUFFER_CHARS = 16 * 1024 * 1024
const MAX_TERMINAL_WRITE_CHARS = 1024 * 1024
const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/

export interface TerminalEnsureSessionInput<TOwner extends string | number> {
  ownerId: TOwner
  scope: string
  key: string
  cwd: string
  cols: number
  rows: number
  attachmentId?: string
  attachmentConnected?: boolean
  forceNew?: boolean
  command?: string
  args?: string[]
}

interface TerminalAttachment {
  cols: number
  rows: number
  connected: boolean
}

interface TerminalSession<TOwner extends string | number> {
  id: string
  ownerId: TOwner
  scope: string
  key: string
  cwd: string
  command?: string
  args?: string[]
  cols: number
  rows: number
  pty: pty.IPty | null
  disposables: Array<{ dispose: () => void }>
  buffer: string
  bufferTruncated: boolean
  sequence: number
  processName: string
  canonicalTitle: string | null
  titleEventVersion: number
  renderModel: TerminalRenderModel | null
  attachments: Map<string, TerminalAttachment>
  controller: TerminalController | null
  allowImplicitAttachControl: boolean
}

interface HeadlessTerminalLike {
  write(data: string | Uint8Array, callback?: () => void): void
  resize(cols: number, rows: number): void
  loadAddon(addon: XTermSerializeAddon): void
  onTitleChange(listener: (title: string) => void): { dispose(): void }
  dispose(): void
}

interface TerminalRenderModel {
  term: HeadlessTerminalLike
  serializeAddon: XTermSerializeAddon
  chain: Promise<void>
}

const headlessModule = ('default' in xtermHeadlessImport ? xtermHeadlessImport.default : xtermHeadlessImport) as {
  Terminal: new (options?: { cols?: number; rows?: number; scrollback?: number; allowProposedApi?: boolean }) => HeadlessTerminalLike
}
const { Terminal: HeadlessTerminal } = headlessModule

export interface TerminalEventSink<TOwner extends string | number> {
  onOutput(ownerId: TOwner, event: TerminalOutputEvent): void
  onTitle?(ownerId: TOwner, event: { sessionId: string; canonicalTitle: string | null }): void
  onExit(ownerId: TOwner, event: TerminalExitEvent): void
  onOwnership?(ownerId: TOwner, event: TerminalOwnershipEvent): void
}

export class TerminalSessionManager<TOwner extends string | number> {
  private readonly sessionsById = new Map<string, TerminalSession<TOwner>>()
  private readonly sessionIdByOwnerKey = new Map<string, string>()
  private readonly sink: TerminalEventSink<TOwner>

  constructor(sink: TerminalEventSink<TOwner>) {
    this.sink = sink
  }

  ensureSession(input: TerminalEnsureSessionInput<TOwner>): TerminalAttachResult {
    const size = normalizeTerminalSize(input.cols, input.rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }

    const cwd = path.resolve(input.cwd)
    const ownerId = input.ownerId
    if (!this.isValidOwnerId(ownerId)) return { ok: false, message: 'error.invalid-arguments' }
    const ownerKey = this.sessionOwnerKey(ownerId, input.key)
    if (input.forceNew) this.closeOwnerKey(ownerId, input.key)
    const existingId = this.sessionIdByOwnerKey.get(ownerKey)
    const existing = existingId ? this.sessionsById.get(existingId) : undefined
    if (existing) {
      if (input.attachmentId) {
        registerAttachment(existing, input.attachmentId, size.cols, size.rows, input.attachmentConnected)
      } else {
        this.resizeSessionPty(existing, size.cols, size.rows)
      }
      return this.attachResult(existing)
    }

    const id = createSessionId()
    const session: TerminalSession<TOwner> = {
      id,
      ownerId,
      scope: input.scope,
      key: input.key,
      cwd,
      command: input.command,
      args: input.args,
      cols: size.cols,
      rows: size.rows,
      pty: null,
      disposables: [],
      buffer: '',
      bufferTruncated: false,
      sequence: 0,
      processName: '',
      canonicalTitle: null,
      titleEventVersion: 0,
      renderModel: null,
      attachments: new Map(),
      controller: null,
      allowImplicitAttachControl: true,
    }
    this.sessionsById.set(id, session)
    this.sessionIdByOwnerKey.set(ownerKey, id)
    if (input.attachmentId) {
      registerAttachment(session, input.attachmentId, size.cols, size.rows, input.attachmentConnected ?? true)
      session.controller = session.attachments.get(input.attachmentId)?.connected
        ? { attachmentId: input.attachmentId, status: 'connected' }
        : null
    }

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
      session.renderModel = createTerminalRenderModel(size.cols, size.rows)
      session.disposables.push(bindRenderModelTitle(session, this.sink))
    } catch (err) {
      this.closeSession(id)
      return { ok: false, message: err instanceof Error ? err.message : 'error.unknown' }
    }

    session.disposables.push(
      session.pty.onData((data) => {
        const seq = appendSessionData(session, data)
        const previousProcessName = session.processName
        const processName = terminalProcessName(session.pty)
        session.processName = processName
        const canonicalTitleBeforeWrite = session.canonicalTitle
        const titleEventVersionBeforeWrite = session.titleEventVersion
        queueRenderWrite(session, data, () => {
          maybeClearCanonicalTitleOnShellReturn(
            session,
            previousProcessName,
            processName,
            canonicalTitleBeforeWrite,
            titleEventVersionBeforeWrite,
            this.sink,
          )
        })
        this.sink.onOutput(session.ownerId, { sessionId: session.id, data, seq, processName })
      }),
    )
    session.disposables.push(
      session.pty.onExit(() => {
        session.pty = null
        this.sink.onExit(session.ownerId, { sessionId: session.id })
        this.closeSession(session.id)
      }),
    )

    return this.attachResult(session)
  }

  writeSession(ownerId: TOwner, sessionId: string, data: string, attachmentId?: string): boolean {
    if (!isValidTerminalSessionId(sessionId) || !isValidTerminalWriteData(data)) return false
    const session = this.ownedSession(ownerId, sessionId)
    if (!session?.pty) return false
    if (attachmentId && session.controller?.attachmentId !== attachmentId) return false
    try {
      session.pty.write(data)
      return true
    } catch (err) {
      console.warn('[terminal] failed to write PTY', err)
      return false
    }
  }

  attachSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): TerminalAttachResult {
    if (!isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.ownedSession(ownerId, sessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (attachmentId) {
      registerAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      if (session.controller === null && session.allowImplicitAttachControl && session.attachments.get(attachmentId)?.connected) {
        this.setControllerAttachment(session, attachmentId)
      }
    } else {
      this.resizeSessionPty(session, size.cols, size.rows)
    }
    return this.attachResult(session)
  }

  resizeSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): boolean {
    if (!isValidTerminalSessionId(sessionId)) return false
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return false
    const session = this.ownedSession(ownerId, sessionId)
    if (!session) return false
    if (attachmentId) {
      registerAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      if (session.controller?.attachmentId !== attachmentId) return false
    }
    return this.resizeSessionPty(session, size.cols, size.rows)
  }

  takeoverSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): TerminalTakeoverResult {
    if (!isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.ownedSession(ownerId, sessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (attachmentId) {
      registerAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      this.setControllerAttachment(session, attachmentId)
      return this.takeoverResult(session)
    }
    return { ok: false, message: 'error.invalid-arguments' }
  }

  restartSession(
    ownerId: TOwner,
    sessionId: string,
    cols: number,
    rows: number,
    attachmentId?: string,
    attachmentConnected?: boolean,
  ): TerminalAttachResult {
    if (!isValidTerminalSessionId(sessionId)) return { ok: false, message: 'error.invalid-arguments' }
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return { ok: false, message: 'error.invalid-arguments' }
    const session = this.ownedSession(ownerId, sessionId)
    if (!session) return { ok: false, message: 'error.invalid-arguments' }
    if (attachmentId) {
      registerAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      session.controller = session.attachments.get(attachmentId)?.connected
        ? { attachmentId, status: 'connected' }
        : null
      if (session.controller) session.allowImplicitAttachControl = false
    }
    this.resetSessionState(session, size.cols, size.rows)
    const spawnResult = this.spawnSessionPty(session)
    if (!spawnResult.ok) return spawnResult
    return this.attachResult(session)
  }

  closeOwnedSession(ownerId: TOwner, sessionId: string): boolean {
    if (!this.ownedSession(ownerId, sessionId)) return false
    this.closeSession(sessionId)
    return true
  }

  closeSession(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return
    this.sessionsById.delete(sessionId)
    const ownerKey = this.sessionOwnerKey(session.ownerId, session.key)
    if (this.sessionIdByOwnerKey.get(ownerKey) === sessionId) this.sessionIdByOwnerKey.delete(ownerKey)
    this.disposeSessionResources(session)
  }

  closeKey(key: string): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.key === key || session.key.startsWith(`${key}\0`)) this.closeSession(session.id)
    }
  }

  closeOwner(ownerId: TOwner): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId === ownerId) this.closeSession(session.id)
    }
  }

  setAttachmentConnected(ownerId: TOwner, attachmentId: string, connected: boolean): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId !== ownerId) continue
      const attachment = session.attachments.get(attachmentId)
      if (!attachment) continue
      if (
        attachment.connected === connected &&
        (session.controller?.attachmentId !== attachmentId || session.controller?.status === (connected ? 'connected' : 'grace'))
      ) {
        continue
      }
      attachment.connected = connected
      if (session.controller?.attachmentId !== attachmentId) {
        if (connected && session.controller === null && session.allowImplicitAttachControl) {
          this.setControllerAttachment(session, attachmentId)
          continue
        }
        if (!connected) this.deleteAttachmentIfInactive(session, attachmentId)
        continue
      }
      const nextStatus: Exclude<TerminalControllerStatus, 'none'> = connected ? 'connected' : 'grace'
      if (session.controller.status === nextStatus) continue
      session.controller = { attachmentId, status: nextStatus }
      this.emitOwnership(session)
    }
  }

  releaseAttachmentControl(ownerId: TOwner, attachmentId: string): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId !== ownerId || session.controller?.attachmentId !== attachmentId) continue
      const attachment = session.attachments.get(attachmentId)
      if (attachment?.connected) continue
      session.controller = null
      session.allowImplicitAttachControl = false
      session.attachments.delete(attachmentId)
      this.pruneInactiveAttachments(session)
      this.emitOwnership(session)
    }
  }

  pruneScope(ownerId: TOwner, scope: string, liveKeys: Set<string>): void {
    for (const session of Array.from(this.sessionsById.values())) {
      const key = terminalPruneKey(session.key)
      if (session.ownerId === ownerId && session.scope === scope && !liveKeys.has(key)) this.closeSession(session.id)
    }
  }

  closeAll(): void {
    for (const sessionId of Array.from(this.sessionsById.keys())) this.closeSession(sessionId)
  }

  async snapshotSession(sessionId: string): Promise<TerminalSessionSnapshot | null> {
    const session = this.sessionsById.get(sessionId)
    if (!session?.renderModel) return null
    const snapshotSeq = session.sequence
    const chain = session.renderModel.chain
    try {
      await chain
    } catch {}
    return {
      sessionId,
      snapshot: session.renderModel.serializeAddon.serialize({ excludeAltBuffer: false }),
      snapshotSeq,
    }
  }

  async listSessions(scope: string): Promise<TerminalSessionSummary[]> {
    const sessions: TerminalSessionSummary[] = []
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.scope === scope) {
        sessions.push({
          sessionId: session.id,
          key: session.key,
          cwd: session.cwd,
          controller: cloneTerminalController(session.controller),
          processName: session.processName,
          canonicalTitle: session.canonicalTitle,
          cols: session.cols,
          rows: session.rows,
        })
      }
    }
    return sessions
  }

  private ownedSession(ownerId: TOwner, sessionId: string): TerminalSession<TOwner> | undefined {
    if (!this.isValidOwnerId(ownerId) || !isValidTerminalSessionId(sessionId)) return undefined
    const session = this.sessionsById.get(sessionId)
    return session?.ownerId === ownerId ? session : undefined
  }

  getSession(ownerId: TOwner, sessionId: string): TerminalSession<TOwner> | undefined {
    if (!this.isValidOwnerId(ownerId) || !isValidTerminalSessionId(sessionId)) return undefined
    const session = this.sessionsById.get(sessionId)
    return session?.ownerId === ownerId ? session : undefined
  }

  private closeOwnerKey(ownerId: TOwner, key: string): void {
    const id = this.sessionIdByOwnerKey.get(this.sessionOwnerKey(ownerId, key))
    if (id) this.closeSession(id)
  }

  private resizeSessionPty(session: TerminalSession<TOwner>, cols: number, rows: number): boolean {
    if (!session.pty) return false
    if (session.cols === cols && session.rows === rows) return true
    try {
      session.pty.resize(cols, rows)
      session.cols = cols
      session.rows = rows
      queueRenderResize(session, cols, rows)
      this.emitOwnership(session)
      return true
    } catch (err) {
      console.warn('[terminal] failed to resize PTY', err)
      return false
    }
  }

  private setControllerAttachment(session: TerminalSession<TOwner>, attachmentId: string): void {
    const attachment = session.attachments.get(attachmentId)
    if (!attachment) return
    if (!attachment.connected) {
      this.deleteAttachmentIfInactive(session, attachmentId)
      return
    }
    const sizeChanged = session.cols !== attachment.cols || session.rows !== attachment.rows
    session.controller = attachment.connected ? { attachmentId, status: 'connected' } : null
    session.allowImplicitAttachControl = false
    this.pruneInactiveAttachments(session)
    this.resizeSessionPty(session, attachment.cols, attachment.rows)
    if (!sizeChanged) this.emitOwnership(session)
  }

  private takeoverResult(session: TerminalSession<TOwner>): TerminalTakeoverResult {
    return {
      ok: true,
      sessionId: session.id,
      controller: cloneTerminalController(session.controller),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
    }
  }

  private attachResult(session: TerminalSession<TOwner>): Extract<TerminalAttachResult, { ok: true }> {
    return {
      ok: true,
      sessionId: session.id,
      replay: session.buffer,
      replaySeq: session.sequence,
      replayTruncated: session.bufferTruncated,
      processName: session.processName,
      canonicalTitle: session.canonicalTitle,
      controller: cloneTerminalController(session.controller),
      canonicalCols: session.cols,
      canonicalRows: session.rows,
    }
  }

  private sessionOwnerKey(ownerId: TOwner, key: string): string {
    return `${String(ownerId)}\0${key}`
  }

  private emitOwnership(session: TerminalSession<TOwner>): void {
    this.sink.onOwnership?.(session.ownerId, {
      sessionId: session.id,
      controller: cloneTerminalController(session.controller),
      cols: session.cols,
      rows: session.rows,
    })
  }

  private resetSessionState(session: TerminalSession<TOwner>, cols: number, rows: number): void {
    this.disposeSessionResources(session)
    session.cols = cols
    session.rows = rows
    session.buffer = ''
    session.bufferTruncated = false
    session.sequence = 0
    session.processName = ''
    session.canonicalTitle = null
    session.titleEventVersion = 0
  }

  private spawnSessionPty(session: TerminalSession<TOwner>): TerminalAttachResult {
    try {
      const shell = session.command || process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/zsh')
      const args = session.args ?? (process.platform === 'win32' ? [] : ['-l'])
      const env = { ...process.env, TERM: 'xterm-256color' }
      session.pty = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: session.cols,
        rows: session.rows,
        cwd: session.cwd,
        env,
      })
      session.processName = terminalProcessName(session.pty)
      session.renderModel = createTerminalRenderModel(session.cols, session.rows)
      session.disposables.push(bindRenderModelTitle(session, this.sink))
    } catch (err) {
      this.disposeSessionResources(session)
      return { ok: false, message: err instanceof Error ? err.message : 'error.unknown' }
    }
    session.disposables.push(
      session.pty.onData((data) => {
        const seq = appendSessionData(session, data)
        const previousProcessName = session.processName
        const processName = terminalProcessName(session.pty)
        session.processName = processName
        const canonicalTitleBeforeWrite = session.canonicalTitle
        const titleEventVersionBeforeWrite = session.titleEventVersion
        queueRenderWrite(session, data, () => {
          maybeClearCanonicalTitleOnShellReturn(
            session,
            previousProcessName,
            processName,
            canonicalTitleBeforeWrite,
            titleEventVersionBeforeWrite,
            this.sink,
          )
        })
        this.sink.onOutput(session.ownerId, { sessionId: session.id, data, seq, processName })
      }),
    )
    session.disposables.push(
      session.pty.onExit(() => {
        session.pty = null
        this.sink.onExit(session.ownerId, { sessionId: session.id })
        this.closeSession(session.id)
      }),
    )
    return this.attachResult(session)
  }

  private disposeSessionResources(session: TerminalSession<TOwner>): void {
    disposeSessionListeners(session)
    if (session.pty) {
      try {
        session.pty.kill()
      } catch (err) {
        console.warn('[terminal] failed to kill PTY', err)
      }
    }
    session.pty = null
    try {
      session.renderModel?.term.dispose()
    } catch {}
    session.renderModel = null
  }

  private isValidOwnerId(ownerId: TOwner): boolean {
    return (typeof ownerId === 'number' && Number.isSafeInteger(ownerId) && ownerId > 0) || (typeof ownerId === 'string' && ownerId.length > 0)
  }

  private deleteAttachmentIfInactive(session: TerminalSession<TOwner>, attachmentId: string): void {
    if (session.controller?.attachmentId === attachmentId) return
    const attachment = session.attachments.get(attachmentId)
    if (!attachment || attachment.connected) return
    session.attachments.delete(attachmentId)
  }

  private pruneInactiveAttachments(session: TerminalSession<TOwner>): void {
    for (const [attachmentId, attachment] of session.attachments.entries()) {
      if (attachment.connected) continue
      if (session.controller?.attachmentId === attachmentId) continue
      session.attachments.delete(attachmentId)
    }
  }
}

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export function isValidTerminalWriteData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TERMINAL_WRITE_CHARS
}

function appendSessionData<TOwner extends string | number>(session: TerminalSession<TOwner>, data: string): number {
  session.sequence += 1
  session.buffer += data
  if (session.buffer.length > MAX_SESSION_BUFFER_CHARS) {
    session.buffer = safeReplayTail(session.buffer, MAX_SESSION_BUFFER_CHARS)
    session.bufferTruncated = true
  }
  return session.sequence
}

function disposeSessionListeners<TOwner extends string | number>(session: TerminalSession<TOwner>): void {
  for (const disposable of session.disposables.splice(0)) {
    try {
      disposable.dispose()
    } catch (err) {
      console.warn('[terminal] failed to dispose PTY listener', err)
    }
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

function normalizeTerminalTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function bindRenderModelTitle<TOwner extends string | number>(
  session: TerminalSession<TOwner>,
  sink: TerminalEventSink<TOwner>,
): { dispose(): void } {
  return session.renderModel?.term.onTitleChange((title) => {
    session.titleEventVersion += 1
    const nextCanonicalTitle = normalizeTerminalTitle(title)
    if (session.canonicalTitle === nextCanonicalTitle) return
    session.canonicalTitle = nextCanonicalTitle
    sink.onTitle?.(session.ownerId, { sessionId: session.id, canonicalTitle: nextCanonicalTitle })
  }) ?? { dispose() {} }
}

function createSessionId(): string {
  return `term_${crypto.randomUUID()}`
}

function terminalPruneKey(key: string): string {
  const parts = key.split('\0')
  return parts.length >= 2 ? `${parts[0]}\0${parts[1]}` : key
}

function registerAttachment<TOwner extends string | number>(
  session: TerminalSession<TOwner>,
  attachmentId: string,
  cols: number,
  rows: number,
  connected?: boolean,
): void {
  const existing = session.attachments.get(attachmentId)
  session.attachments.set(attachmentId, {
    cols,
    rows,
    connected: connected ?? existing?.connected ?? false,
  })
}

function createTerminalRenderModel(cols: number, rows: number): TerminalRenderModel {
  const term = new HeadlessTerminal({ cols, rows, scrollback: 10000, allowProposedApi: true })
  const serializeAddon = new SerializeAddon()
  term.loadAddon(serializeAddon)
  return {
    term,
    serializeAddon,
    chain: Promise.resolve(),
  }
}

function queueRenderWrite<TOwner extends string | number>(
  session: TerminalSession<TOwner>,
  data: string,
  onParsed?: () => void,
): void {
  const model = session.renderModel
  if (!model) return
  model.chain = model.chain
    .catch(() => {})
    .then(
      () =>
        new Promise<void>((resolve) => {
          model.term.write(data, resolve)
        }),
    )
    .then(() => {
      if (session.renderModel !== model) return
      onParsed?.()
    })
}

function queueRenderResize<TOwner extends string | number>(session: TerminalSession<TOwner>, cols: number, rows: number): void {
  const model = session.renderModel
  if (!model) return
  model.chain = model.chain
    .catch(() => {})
    .then(() => {
      model.term.resize(cols, rows)
    })
}

function maybeClearCanonicalTitleOnShellReturn<TOwner extends string | number>(
  session: TerminalSession<TOwner>,
  previousProcessName: string,
  nextProcessName: string,
  canonicalTitleBeforeWrite: string | null,
  titleEventVersionBeforeWrite: number,
  sink: TerminalEventSink<TOwner>,
): void {
  if (!canonicalTitleBeforeWrite) return
  if (previousProcessName === nextProcessName) return
  if (!isShellProcessName(nextProcessName) || isShellProcessName(previousProcessName)) return
  if (session.processName !== nextProcessName) return
  if (session.titleEventVersion !== titleEventVersionBeforeWrite) return
  if (session.canonicalTitle !== canonicalTitleBeforeWrite) return
  session.canonicalTitle = null
  sink.onTitle?.(session.ownerId, { sessionId: session.id, canonicalTitle: null })
}

function isShellProcessName(processName: string): boolean {
  return /^(?:ba|z|fi|tc|c|k)?sh$|^nu$/.test(processName)
}
