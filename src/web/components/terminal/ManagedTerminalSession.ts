import type { ISearchResultChangeEvent } from '@xterm/addon-search'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalAttachResult,
  TerminalExitEvent,
  TerminalAttachInput,
  TerminalOutputEvent,
  TerminalRestartInput,
  TerminalSessionPhase,
} from '#/shared/terminal.ts'
import { resolveTerminalOwnership } from '#/shared/terminal.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import { preloadTerminalFont } from '#/web/components/terminal/terminal-geometry.ts'
import { TerminalSessionRuntime } from '#/web/components/terminal/terminal-session-runtime.ts'
import { TerminalSessionView } from '#/web/components/terminal/terminal-session-view.ts'
import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import type {
  TerminalBellEvent,
  TerminalDescriptor,
  TerminalOwnershipViewModel,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'
const EMPTY_SEARCH_RESULT: TerminalSearchResult = { resultIndex: -1, resultCount: 0, found: false }

export type TerminalNotifyReason = 'metadata' | 'outputSummary'

type TerminalAttachResultWithOwnership = Extract<TerminalAttachResult, { ok: true }> & {
  role: TerminalOwnershipViewModel['role']
  controllerStatus: TerminalOwnershipViewModel['controllerStatus']
}

export class ManagedTerminalSession {
  descriptor: TerminalDescriptor
  private readonly notify: (reason: TerminalNotifyReason) => void
  private readonly onBell: ((descriptor: TerminalDescriptor, event: TerminalBellEvent) => void) | null
  private readonly runtime = new TerminalSessionRuntime()
  private readonly view: TerminalSessionView
  private startToken = 0
  private resizeFlushScheduled = false
  private outputFlushFrame: number | null = null

  private pendingResize: { cols: number; rows: number } | null = null
  private pendingOutput: string[] = []
  private pendingWriteBuffer = ''
  private inputFlushScheduled = false
  private hydratedSnapshot: { snapshot: string; snapshotSeq: number } | null = null
  private disposed = false

  constructor(
    descriptor: TerminalDescriptor,
    notify: (reason: TerminalNotifyReason) => void,
    onBell: ((descriptor: TerminalDescriptor, event: TerminalBellEvent) => void) | null = null,
  ) {
    this.descriptor = descriptor
    this.notify = notify
    this.onBell = onBell
    this.view = new TerminalSessionView({
      onInput: (data) => this.writeInput(data),
      onBell: () => this.handleBell(),
      onResize: ({ cols, rows }) => this.queueResize(cols, rows),
      onSearchResult: (event) => this.updateSearchResult(event),
      onProgress: (state, value) => this.updateProgress(state, value),
      onOpenExternalLink: (uri) => this.openExternalLink(uri),
    })
  }

  updateDescriptor(descriptor: TerminalDescriptor): void {
    this.descriptor = descriptor
  }

  attach(host: HTMLElement): void {
    if (this.disposed) return
    this.view.attach(host)
    if (this.runtime.canResize()) {
      if (this.view.currentTerminal()) {
        this.view.fitSoon()
      } else {
        this.start()
      }
    }
    if (this.runtime.phase() === 'open' && this.runtime.canResize() && this.view.isVisible()) this.view.focus()
  }

  detach(host: HTMLElement, parkingRoot: HTMLElement): void {
    this.clearTerminalFocusIfOwned()
    this.view.detach(host, parkingRoot)
  }

  restart(): void {
    if (this.disposed) return
    const { changed } = this.runtime.prepareRestart()
    this.destroyActiveView()
    if (changed) this.notify('metadata')
    this.start()
  }

  dispose(options: { closeSession?: boolean } = {}): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTerminalFocusIfOwned()
    this.view.blurIfFocused()
    const sessionIds = this.runtime.disposeSessionIds()
    if (options.closeSession !== false) {
      for (const sessionId of sessionIds) void terminalBridge.close({ sessionId }).catch(() => {})
    }
    this.destroyActiveView()
    this.view.disposeFrame()
  }

  snapshot() {
    return this.runtime.snapshot()
  }

  isTerminalFocusTarget(target: EventTarget | null): boolean {
    return this.view.isTerminalFocusTarget(target)
  }

  writeInput(data: string): void {
    const sessionId = this.runtime.currentSessionId()
    if (!sessionId || !this.runtime.canResize()) return
    this.pendingWriteBuffer += data
    this.scheduleInputFlush()
  }

  private scheduleInputFlush(): void {
    if (this.disposed || this.inputFlushScheduled) return
    this.inputFlushScheduled = true
    queueMicrotask(() => {
      this.inputFlushScheduled = false
      this.flushInput()
    })
  }

  private flushInput(): void {
    if (this.disposed) return
    const sessionId = this.runtime.currentSessionId()
    if (!sessionId || !this.runtime.canResize()) return
    const data = this.pendingWriteBuffer
    this.pendingWriteBuffer = ''
    if (!data) return
    void terminalBridge.write({ sessionId, data }).catch((err) => {
      // Keystrokes that fail to reach the shell leave the user thinking
      // their input was accepted — surface the failure so a debugger can
      // correlate with terminalBridge.write validation/transport errors.
      console.warn('[terminal] write failed for session', sessionId, err)
    })
  }

  findNext(term: string, incremental = false): TerminalSearchResult {
    return this.find(term, 'next', incremental)
  }

  findPrevious(term: string): TerminalSearchResult {
    return this.find(term, 'previous', false)
  }

  clearSearch(): void {
    this.view.clearSearch()
    this.setSearchResult(null)
  }

  scrollToBottom(): void {
    this.view.scrollToBottom()
  }

  scrollLines(amount: number): void {
    this.view.scrollLines(amount)
  }

  serialize(): string {
    return this.view.serialize()
  }

  currentSessionId(): string | null {
    return this.runtime.currentSessionId()
  }

  hydrate(input: {
    sessionId: string
    phase: TerminalSessionPhase
    message: string | null
    processName: string
    canonicalTitle?: string | null
    role: TerminalOwnershipViewModel['role']
    controllerStatus: TerminalOwnershipViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
    snapshot?: string
    snapshotSeq?: number
  }): void {
    this.hydratedSnapshot =
      typeof input.snapshot === 'string' && typeof input.snapshotSeq === 'number'
        ? { snapshot: input.snapshot, snapshotSeq: input.snapshotSeq }
        : null
    const previousSessionId = this.runtime.currentSessionId()
    const changed = this.runtime.hydrateSession({
      sessionId: input.sessionId,
      phase: input.phase,
      message: input.message,
      processName: input.processName,
      canonicalTitle: input.canonicalTitle ?? null,
      role: input.role,
      controllerStatus: input.controllerStatus,
      canonicalCols: input.canonicalCols,
      canonicalRows: input.canonicalRows,
    })
    if (previousSessionId && previousSessionId !== input.sessionId) this.applyHydratedSnapshotToActiveView()
    if (changed) this.notify('metadata')
  }

  handleOutput(event: TerminalOutputEvent): void {
    const result = this.runtime.handleOutput(event)
    if (result.changed) this.notify('metadata')
    if (result.summaryChanged) this.scheduleSummaryNotify()
    if (result.output && this.runtime.canResize()) this.queueOutput(result.output)
  }

  handleOwnership(event: TerminalOwnershipViewModel): void {
    const wasController = this.runtime.canResize()
    const changed = this.runtime.handleOwnership(event)
    const pendingCleared = this.runtime.clearTakeoverPending()
    if (changed) {
      const isController = this.runtime.canResize()
      if (!isController) {
        if (this.view.currentTerminal()) {
          this.destroyActiveView({ preserveTransientState: true })
        }
      } else if (!wasController && isController) {
        if (this.view.isConnected() && !this.view.currentTerminal()) {
          this.start()
        }
        if (this.view.isVisible()) this.view.focus()
      }
    }
    if (changed || pendingCleared) {
      this.notify('metadata')
    }
  }

  handleServerTitle(canonicalTitle: string | null): void {
    if (this.runtime.setCanonicalTitle(canonicalTitle)) this.notify('metadata')
  }

  handleExit(event: TerminalExitEvent): boolean {
    if (!this.runtime.handleExit(event)) return false
    this.flushOutput()
    this.clearTerminalFocusIfOwned()
    this.view.blurIfFocused()
    return true
  }

  takeover(): void {
    const sessionId = this.runtime.currentSessionId()
    if (!sessionId) return
    const term = this.view.currentTerminal()
    const size = term ? { cols: term.cols, rows: term.rows } : this.runtime.currentCanonicalSize()
    // Ownership changes are applied exclusively via authoritative onOwnership realtime messages.
    // The bridge response is only used to trigger the server-side handoff.
    if (this.runtime.setTakeoverPending(true)) this.notify('metadata')
    void terminalBridge
      .takeover({ sessionId, cols: size.cols, rows: size.rows })
      .catch(() => {})
      .finally(() => {
        // If the server response settles but we never received an ownership event,
        // clear the pending state so the user can retry.
        if (this.runtime.isTakeoverPending()) {
          if (this.runtime.setTakeoverPending(false)) this.notify('metadata')
        }
      })
  }

  private start(): void {
    if (this.disposed || this.view.currentTerminal() || !this.view.isConnected()) return
    const token = (this.startToken += 1)
    if (!this.runtime.currentSessionId() && this.runtime.startAttaching()) this.notify('metadata')
    void this.startAsync(token)
  }

  private async startAsync(token: number): Promise<void> {
    try {
      const { term, preloaded } = await this.openPhase(token)
      const result = await this.ipcPhase(token, term)
      if (result.phase === 'error') {
        const changed = this.runtime.applyAttachResult(result, { cols: term.cols, rows: term.rows })
        this.destroyActiveView()
        if (changed) this.notify('metadata')
        return
      }
      await this.replayPhase(token, term, result, preloaded)
      this.finalizePhase(token, term)
    } catch (err) {
      if (err instanceof StartCancelledError) return
      this.closeReplacingPtySession()
      if (!this.currentToken(token)) return
      this.destroyActiveView()
      if (this.runtime.failRuntime(err instanceof Error ? err.message : String(err))) this.notify('metadata')
    }
  }

  private async openPhase(token: number): Promise<{ term: XTermTerminal; preloaded: boolean }> {
    if (this.disposed || this.startToken !== token || this.view.currentTerminal()) throw new StartCancelledError()
    await preloadTerminalFont()
    const term = this.view.openTerminal((input) => this.writeInput(input))
    const preloaded = await this.preloadHydratedSnapshot(token, term)
    await waitForTerminalLayout()
    this.guardStart(token, term)
    this.view.fitNow()
    await waitForTerminalLayout()
    this.guardStart(token, term)
    return { term, preloaded }
  }

  private async ipcPhase(token: number, term: XTermTerminal): Promise<TerminalAttachResultWithOwnership> {
    const restart = this.runtime.consumeRestartFlag()
    const sessionId = restart ? this.runtime.restartingSessionId() : this.runtime.currentSessionId()
    if (!sessionId) {
      this.destroyActiveView()
      if (this.runtime.failAttachAttempt('error.invalid-arguments')) this.notify('metadata')
      throw new StartCancelledError()
    }
    const result = restart
      ? await terminalBridge.restart(this.terminalRestartInput(sessionId, term))
      : await terminalBridge.attach(this.terminalAttachInput(sessionId, term))
    if (this.disposed || this.startToken !== token || this.view.currentTerminal() !== term) {
      if (result.ok) void terminalBridge.close({ sessionId: result.sessionId }).catch(() => {})
      else this.closeReplacingPtySession()
      throw new StartCancelledError()
    }
    this.runtime.settleStartAttempt()
    if (!result.ok) {
      this.closeReplacingPtySession()
      this.destroyActiveView()
      if (this.runtime.failAttachAttempt(result.message)) this.notify('metadata')
      throw new StartCancelledError()
    }
    return this.withLocalOwnership(result)
  }

  private async replayPhase(
    token: number,
    term: XTermTerminal,
    result: TerminalAttachResultWithOwnership,
    preloaded: boolean,
  ): Promise<void> {
    let changed = this.runtime.applyAttachResult(result, { cols: term.cols, rows: term.rows })
    if (!this.runtime.canResize()) {
      this.applyCanonicalSizeToView()
    } else {
      const canonicalSize = this.runtime.currentCanonicalSize()
      if (term.cols !== canonicalSize.cols || term.rows !== canonicalSize.rows) {
        this.queueResize(term.cols, term.rows)
      }
    }
    await this.replayActiveView(token, term, result.snapshot ?? result.replay, result.snapshotSeq ?? result.replaySeq)
    this.guardStart(token, term)
  }

  private finalizePhase(token: number, term: XTermTerminal): void {
    this.guardStart(token, term)
    const changed = this.runtime.markAttached()
    if (changed) this.notify('metadata')
    if (this.view.isVisible()) term.focus()
  }

  private guardStart(token: number, term: XTermTerminal): void {
    if (this.disposed || this.startToken !== token || this.view.currentTerminal() !== term) {
      throw new StartCancelledError()
    }
  }

  private terminalAttachInput(sessionId: string, term: XTermTerminal): TerminalAttachInput {
    return {
      sessionId,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private terminalRestartInput(sessionId: string, term: XTermTerminal): TerminalRestartInput {
    return {
      sessionId,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private withLocalOwnership(result: Extract<TerminalAttachResult, { ok: true }>): TerminalAttachResultWithOwnership {
    const attachmentId = readOrCreateWebTerminalAttachmentId()
    return {
      ...result,
      ...resolveTerminalOwnership(result.controller, attachmentId),
    }
  }

  private async replayActiveView(token: number, term: XTermTerminal, replay: string, replaySeq: number): Promise<void> {
    this.runtime.beginReplay(replaySeq)
    try {
      term.reset()
      if (replay) await termWrite(term, replay)
    } finally {
      if (this.currentStart(token, term)) {
        for (const event of this.runtime.finishReplay()) this.queueOutput(event.data)
      }
    }
  }

  private async preloadHydratedSnapshot(token: number, term: XTermTerminal): Promise<boolean> {
    const hydratedSnapshot = this.hydratedSnapshot
    if (!hydratedSnapshot || !this.currentStart(token, term)) return false
    this.runtime.beginReplay(hydratedSnapshot.snapshotSeq)
    try {
      term.reset()
      if (hydratedSnapshot.snapshot) await termWrite(term, hydratedSnapshot.snapshot)
      return this.currentStart(token, term)
    } finally {
      if (this.currentStart(token, term)) this.runtime.finishReplay()
    }
  }

  private applyHydratedSnapshotToActiveView(): void {
    const term = this.view.currentTerminal()
    const hydratedSnapshot = this.hydratedSnapshot
    if (!term) return
    term.reset()
    if (hydratedSnapshot?.snapshot) term.write(hydratedSnapshot.snapshot)
  }

  private queueResize(cols: number, rows: number): void {
    if (!this.runtime.currentSessionId() || !this.runtime.canResize()) return
    const canonicalSize = this.runtime.currentCanonicalSize()
    if (canonicalSize.cols === cols && canonicalSize.rows === rows && !this.pendingResize) return
    this.pendingResize = { cols, rows }
    if (this.resizeFlushScheduled) return
    this.resizeFlushScheduled = true
    queueMicrotask(() => {
      this.resizeFlushScheduled = false
      this.flushResize()
    })
  }

  private flushResize(): void {
    const sessionId = this.runtime.currentSessionId()
    const resize = this.pendingResize
    if (!sessionId || !resize) return
    if (!this.runtime.canResize()) return
    this.pendingResize = null
    const { cols, rows } = resize
    const canonicalSize = this.runtime.currentCanonicalSize()
    if (canonicalSize.cols === cols && canonicalSize.rows === rows) return
    void terminalBridge
      .resize({ sessionId, cols, rows })
      .then((ok) => {
        if (ok && this.runtime.currentSessionId() === sessionId) this.runtime.acknowledgeResize(cols, rows)
      })
      .catch((err) => {
        // Resize rejection leaves the view stuck at the old geometry —
        // surface the failure so ops can correlate with server-side
        // validation rejections (size out of range, lost controller, etc.).
        console.warn('[terminal] resize failed for session', sessionId, err)
      })
  }

  private applyCanonicalSizeToView(): void {
    const { cols, rows } = this.runtime.currentCanonicalSize()
    if (cols > 0 && rows > 0) this.view.resizeTo(cols, rows)
  }

  private cancelResizeFlush(): void {
    this.resizeFlushScheduled = false
  }

  private queueOutput(data: string): void {
    if (!this.view.currentTerminal()) return
    this.pendingOutput.push(data)
    if (this.outputFlushFrame !== null) return
    this.outputFlushFrame = requestAnimationFrame(() => {
      this.outputFlushFrame = null
      this.flushOutput()
    })
  }

  private flushOutput(): void {
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    if (!this.pendingOutput.length) return
    const output = this.pendingOutput.join('')
    this.pendingOutput = []
    this.view.currentTerminal()?.write(output)
  }

  private destroyActiveView(options?: { preserveTransientState?: boolean }): void {
    this.cancelResizeFlush()
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    this.pendingResize = null
    this.pendingOutput = []
    this.pendingWriteBuffer = ''
    this.inputFlushScheduled = false
    this.startToken += 1
    if (!options?.preserveTransientState) this.runtime.resetTransientState()
    this.view.destroyTerminal()
  }

  private scheduleSummaryNotify(): void {
    this.notify('outputSummary')
  }

  private currentStart(token: number, term: XTermTerminal): boolean {
    return !this.disposed && this.startToken === token && this.view.currentTerminal() === term
  }

  private currentToken(token: number): boolean {
    return !this.disposed && this.startToken === token
  }

  private updateProgress(state: number, value: number): void {
    if (this.runtime.setProgress(state, value)) this.notify('metadata')
  }

  private handleBell(): void {
    this.onBell?.(this.descriptor, {
      processName: this.runtime.processName(),
      canonicalTitle: this.runtime.canonicalTitle(),
      visible: this.view.isVisible(),
    })
  }

  private find(term: string, direction: 'next' | 'previous', incremental: boolean): TerminalSearchResult {
    if (!term) {
      this.clearSearch()
      return EMPTY_SEARCH_RESULT
    }
    const found = this.view.find(term, direction, incremental)
    if (!found) this.setSearchResult(EMPTY_SEARCH_RESULT)
    return this.runtime.currentSearchResult() ?? { ...EMPTY_SEARCH_RESULT, found }
  }

  private updateSearchResult(event: ISearchResultChangeEvent): void {
    this.setSearchResult({
      resultIndex: event.resultIndex,
      resultCount: event.resultCount,
      found: event.resultCount > 0,
    })
  }

  private setSearchResult(result: TerminalSearchResult | null): void {
    if (this.runtime.setSearchResult(result)) this.notify('metadata')
  }

  private openExternalLink(uri: string): void {
    if (!isHttpExternalUrl(uri)) return
    void openExternalUrl(uri).catch(() => {})
  }

  private clearTerminalFocusIfOwned(): void {
    if (this.isTerminalFocusTarget(document.activeElement)) setTerminalFocused(false)
  }

  private closeReplacingPtySession(): void {
    const sessionId = this.runtime.closeReplacingSessionId()
    if (sessionId) void terminalBridge.close({ sessionId }).catch(() => {})
  }
}

function waitForTerminalLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function termWrite(term: XTermTerminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    term.write(data, resolve)
  })
}

function cancelScheduledAnimationFrame(frame: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  else clearTimeout(frame)
}

function isHttpExternalUrl(value: string): boolean {
  try {
    if (value.length > 4096 || /[\0-\x1f\x7f]/.test(value)) return false
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

class StartCancelledError extends Error {
  constructor() {
    super('start cancelled')
  }
}
