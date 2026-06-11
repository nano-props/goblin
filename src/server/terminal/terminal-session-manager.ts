import crypto from 'node:crypto'
import path from 'node:path'
import {
  cloneTerminalController,
  normalizeTerminalSize,
  type TerminalAttachResult,
  type TerminalController,
  type TerminalExitEvent,
  type TerminalOwnershipEvent,
  type TerminalOutputEvent,
  type TerminalSessionSnapshot,
  type TerminalSessionSummary,
  type TerminalTakeoverResult,
} from '#/shared/terminal.ts'
import {
  attachTerminalAttachment,
  claimTerminalAttachmentControl,
  registerTerminalAttachment,
  releaseTerminalAttachmentControl,
  restartTerminalAttachmentControl,
  type TerminalAttachmentState,
  updateTerminalAttachmentConnection,
} from '#/server/terminal/terminal-ownership.ts'
import {
  appendTerminalReplayData,
  bindTerminalRenderTitle,
  createEmptyTerminalRenderState,
  createTerminalRenderModel,
  disposeTerminalRenderState,
  maybeClearCanonicalTitleOnShellReturn,
  queueTerminalRenderResize,
  queueTerminalRenderWrite,
  resetTerminalRenderState,
  snapshotTerminalRenderState,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'
import { spawnTerminalPtyRuntime, type TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'

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
  pty: TerminalPtyRuntime | null
  disposables: Array<{ dispose: () => void }>
  render: TerminalRenderState
  processName: string
  attachmentId: string | null
  attachment: TerminalAttachmentState | null
  controller: TerminalController | null
  allowImplicitAttachControl: boolean
  /** Input queue ensures ordered PTY writes even with multiple concurrent callers. */
  inputQueue: string[]
  /** True when a microtask flush has already been scheduled for this session. */
  inputFlushScheduled: boolean
}

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
        registerTerminalAttachment(existing, input.attachmentId, size.cols, size.rows, input.attachmentConnected)
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
      render: createEmptyTerminalRenderState(),
      processName: '',
      attachmentId: null,
      attachment: null,
      controller: null,
      allowImplicitAttachControl: true,
      inputQueue: [],
      inputFlushScheduled: false,
    }
    this.sessionsById.set(id, session)
    this.sessionIdByOwnerKey.set(ownerKey, id)
    if (input.attachmentId) {
      registerTerminalAttachment(session, input.attachmentId, size.cols, size.rows, input.attachmentConnected ?? true)
      session.controller = session.attachment?.connected
        ? { attachmentId: input.attachmentId, status: 'connected' }
        : null
    }
    const spawnResult = this.spawnSessionPty(session)
    if (!spawnResult.ok) {
      this.closeSession(id)
      return spawnResult
    }
    return spawnResult
  }

  writeSession(ownerId: TOwner, sessionId: string, data: string, attachmentId?: string): boolean {
    if (!isValidTerminalSessionId(sessionId) || !isValidTerminalWriteData(data)) return false
    const session = this.ownedSession(ownerId, sessionId)
    if (!session?.pty) return false
    if (attachmentId && session.controller?.attachmentId !== attachmentId) return false
    session.inputQueue.push(data)
    this.scheduleInputFlush(session)
    return true
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
      registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      this.applyOwnershipEffect(session, attachTerminalAttachment(session, attachmentId))
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
    if (!attachmentId) return false
    registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
    if (session.controller?.attachmentId !== attachmentId) return false
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
      registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      this.applyOwnershipEffect(session, claimTerminalAttachmentControl(session, attachmentId))
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
      registerTerminalAttachment(session, attachmentId, size.cols, size.rows, attachmentConnected)
      restartTerminalAttachmentControl(session, attachmentId)
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
      this.applyOwnershipEffect(session, updateTerminalAttachmentConnection(session, attachmentId, connected))
    }
  }

  releaseAttachmentControl(ownerId: TOwner, attachmentId: string): void {
    for (const session of Array.from(this.sessionsById.values())) {
      if (session.ownerId !== ownerId) continue
      if (!releaseTerminalAttachmentControl(session, attachmentId)) continue
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
    if (!session) return null
    return await snapshotTerminalRenderState(sessionId, session.render)
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
          canonicalTitle: session.render.canonicalTitle,
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
      queueTerminalRenderResize(session.render, cols, rows)
      this.emitOwnership(session)
      return true
    } catch (err) {
      console.warn('[terminal] failed to resize PTY', err)
      return false
    }
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
      replay: session.render.buffer,
      replaySeq: session.render.sequence,
      replayTruncated: session.render.bufferTruncated,
      processName: session.processName,
      canonicalTitle: session.render.canonicalTitle,
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

  private applyOwnershipEffect(
    session: TerminalSession<TOwner>,
    effect: { resizeTo?: { cols: number; rows: number }; emitOwnership: boolean },
  ): void {
    if (effect.resizeTo) this.resizeSessionPty(session, effect.resizeTo.cols, effect.resizeTo.rows)
    if (effect.emitOwnership) this.emitOwnership(session)
  }

  private resetSessionState(session: TerminalSession<TOwner>, cols: number, rows: number): void {
    this.disposeSessionResources(session)
    session.cols = cols
    session.rows = rows
    resetTerminalRenderState(session.render)
    session.processName = ''
    session.inputQueue = []
    session.inputFlushScheduled = false
  }

  private spawnSessionPty(session: TerminalSession<TOwner>): TerminalAttachResult {
    const spawnResult = spawnTerminalPtyRuntime({
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
    })
    if (!spawnResult.ok) {
      this.disposeSessionResources(session)
      return spawnResult
    }
    session.pty = spawnResult.runtime
    session.processName = session.pty.processName()
    session.render.model = createTerminalRenderModel(session.cols, session.rows)
    session.disposables.push(
      bindTerminalRenderTitle(session.render, (canonicalTitle) => {
        this.sink.onTitle?.(session.ownerId, { sessionId: session.id, canonicalTitle })
      }),
    )
    session.disposables.push(
      session.pty.onData((data) => {
        const seq = appendTerminalReplayData(session.render, data)
        const previousProcessName = session.processName
        const processName = session.pty?.processName() ?? 'terminal'
        session.processName = processName
        const canonicalTitleBeforeWrite = session.render.canonicalTitle
        const titleEventVersionBeforeWrite = session.render.titleEventVersion
        queueTerminalRenderWrite(session.render, data, () => {
          maybeClearCanonicalTitleOnShellReturn(
            session.id,
            session.render,
            previousProcessName,
            processName,
            session.processName,
            canonicalTitleBeforeWrite,
            titleEventVersionBeforeWrite,
            (canonicalTitle) => {
              this.sink.onTitle?.(session.ownerId, { sessionId: session.id, canonicalTitle })
            },
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
    session.inputQueue = []
    session.inputFlushScheduled = false
    disposeTerminalRenderState(session.render)
  }

  private scheduleInputFlush(session: TerminalSession<TOwner>): void {
    if (session.inputFlushScheduled || session.inputQueue.length === 0 || !session.pty) return
    session.inputFlushScheduled = true
    queueMicrotask(() => {
      session.inputFlushScheduled = false
      this.drainInputQueue(session)
    })
  }

  private drainInputQueue(session: TerminalSession<TOwner>): void {
    if (session.inputQueue.length === 0 || !session.pty) return
    const batch = session.inputQueue.splice(0).join('')
    try {
      session.pty.write(batch)
    } catch (err) {
      console.warn('[terminal] failed to write PTY', err)
    }
  }

  private isValidOwnerId(ownerId: TOwner): boolean {
    return (typeof ownerId === 'number' && Number.isSafeInteger(ownerId) && ownerId > 0) || (typeof ownerId === 'string' && ownerId.length > 0)
  }

}

export function isValidTerminalSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export function isValidTerminalWriteData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TERMINAL_WRITE_CHARS
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

function createSessionId(): string {
  return `term_${crypto.randomUUID()}`
}

function terminalPruneKey(key: string): string {
  const parts = key.split('\0')
  return parts.length >= 2 ? `${parts[0]}\0${parts[1]}` : key
}
