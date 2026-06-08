import type { ISearchResultChangeEvent } from '@xterm/addon-search'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalAttachResult,
  TerminalExitEvent,
  TerminalAttachInput,
  TerminalOutputEvent,
  TerminalRestartInput,
} from '#/shared/terminal.ts'
import { resolveTerminalOwnership } from '#/shared/terminal.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import { TerminalSessionRuntime } from '#/web/components/terminal/terminal-session-runtime.ts'
import { TerminalSessionView } from '#/web/components/terminal/terminal-session-view.ts'
import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import type {
  TerminalBellEvent,
  TerminalDescriptor,
  TerminalOwnershipViewModel,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'
const RESIZE_DEBOUNCE_MS = 80
const EMPTY_SEARCH_RESULT: TerminalSearchResult = { resultIndex: -1, resultCount: 0, found: false }

export class ManagedTerminalSession {
  descriptor: TerminalDescriptor
  private readonly notify: () => void
  private readonly onBell: ((descriptor: TerminalDescriptor, event: TerminalBellEvent) => void) | null
  private readonly runtime = new TerminalSessionRuntime()
  private readonly view: TerminalSessionView
  private startToken = 0
  private resizeFlushTimer: number | null = null
  private outputFlushFrame: number | null = null
  private pendingResize: { cols: number; rows: number } | null = null
  private pendingOutput: string[] = []
  private hydratedSnapshot: { snapshot: string; snapshotSeq: number } | null = null
  private disposed = false

  constructor(
    descriptor: TerminalDescriptor,
    notify: () => void,
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
    if (this.view.currentTerminal()) {
      if (this.runtime.canResize()) {
        this.view.fitSoon()
      } else {
        const canonicalSize = this.runtime.currentCanonicalSize()
        if (canonicalSize.cols > 0 && canonicalSize.rows > 0) {
          this.view.resizeTo(canonicalSize.cols, canonicalSize.rows)
        }
      }
    }
    this.start()
    if (this.runtime.phase() === 'open' && this.runtime.canResize()) this.view.focus()
  }

  detach(host: HTMLElement, parkingRoot: HTMLElement): void {
    this.clearTerminalFocusIfOwned()
    this.view.detach(host, parkingRoot)
  }

  restart(): void {
    if (this.disposed) return
    const { changed } = this.runtime.prepareRestart()
    this.destroyActiveView()
    if (changed) this.notify()
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
    void terminalBridge.write({ sessionId, data }).catch(() => {})
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
      processName: input.processName,
      canonicalTitle: input.canonicalTitle ?? null,
      role: input.role,
      controllerStatus: input.controllerStatus,
      canonicalCols: input.canonicalCols,
      canonicalRows: input.canonicalRows,
    })
    if (previousSessionId && previousSessionId !== input.sessionId) this.applyHydratedSnapshotToActiveView()
    if (changed) this.notify()
  }

  handleOutput(event: TerminalOutputEvent): void {
    const result = this.runtime.handleOutput(event)
    if (result.changed || result.output) this.notify()
    if (result.output) this.queueOutput(result.output)
  }

  handleOwnership(event: TerminalOwnershipViewModel): void {
    const wasController = this.runtime.canResize()
    if (this.runtime.handleOwnership(event)) {
      const isController = this.runtime.canResize()
      if (!isController) {
        const size = this.runtime.currentCanonicalSize()
        if (size.cols > 0 && size.rows > 0) {
          this.view.resizeTo(size.cols, size.rows)
        }
      } else if (!wasController && isController) {
        this.view.fitSoon()
      }
      this.notify()
    }
  }

  handleServerTitle(canonicalTitle: string | null): void {
    if (this.runtime.setCanonicalTitle(canonicalTitle)) this.notify()
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
    const term = this.view.currentTerminal()
    if (!sessionId || !term) return
    void terminalBridge
      .takeover({ sessionId, cols: term.cols, rows: term.rows })
      .then((result) => {
        if (!result.ok || this.runtime.currentSessionId() !== sessionId) return
        if (
          this.runtime.handleOwnership({
            sessionId: result.sessionId,
            ...resolveTerminalOwnership(result.controller, readOrCreateWebTerminalAttachmentId()),
            canonicalCols: result.canonicalCols,
            canonicalRows: result.canonicalRows,
          })
        ) {
          this.notify()
        }
      })
      .catch(() => {})
  }

  private start(): void {
    if (this.disposed || this.view.currentTerminal() || !this.view.isConnected()) return
    const token = (this.startToken += 1)
    if (!this.runtime.currentSessionId() && this.runtime.startAttaching()) this.notify()
    void this.startAsync(token)
  }

  private async startAsync(token: number): Promise<void> {
    let term: XTermTerminal | null = null
    try {
      if (this.disposed || this.startToken !== token || this.view.currentTerminal()) return
      term = this.view.openTerminal((input) => this.writeInput(input))
      const preloadedHydratedSnapshot = await this.preloadHydratedSnapshot(token, term)
      await waitForTerminalLayout()
      if (!this.currentStart(token, term)) return
      const restart = this.runtime.consumeRestartFlag()
      const sessionId = restart ? this.runtime.restartingSessionId() : this.runtime.currentSessionId()
      if (!sessionId) {
        this.destroyActiveView()
        if (this.runtime.failAttachAttempt('error.invalid-arguments')) this.notify()
        return
      }
      this.view.fitNow()
      await waitForTerminalLayout()
      if (!this.currentStart(token, term)) return
      const result = restart
        ? await terminalBridge.restart(this.terminalRestartInput(sessionId, term))
        : await terminalBridge.attach(this.terminalAttachInput(sessionId, term))
      if (!this.currentStart(token, term)) {
        if (result.ok) void terminalBridge.close({ sessionId: result.sessionId }).catch(() => {})
        else this.closeReplacingPtySession()
        return
      }
      this.runtime.settleStartAttempt()
      if (!result.ok) {
        this.closeReplacingPtySession()
        this.destroyActiveView()
        if (this.runtime.failAttachAttempt(result.message)) this.notify()
        return
      }
      let changed = this.runtime.applyAttachResult(this.withLocalOwnership(result), {
        cols: term.cols,
        rows: term.rows,
      })
      if (!this.runtime.canResize()) {
        const canonicalSize = this.runtime.currentCanonicalSize()
        if (canonicalSize.cols > 0 && canonicalSize.rows > 0) {
          this.view.resizeTo(canonicalSize.cols, canonicalSize.rows)
        }
      }
      await this.replayActiveView(
        token,
        term,
        result.snapshot ?? result.replay,
        result.snapshotSeq ?? result.replaySeq,
        preloadedHydratedSnapshot || !!result.snapshot ? true : result.replayTruncated,
      )
      if (!this.currentStart(token, term)) return
      changed = this.runtime.markAttached() || changed
      if (changed) this.notify()
      if (this.view.isVisible()) term.focus()
    } catch (err) {
      this.closeReplacingPtySession()
      if (!this.currentToken(token)) return
      this.destroyActiveView()
      if (this.runtime.failRuntime(err instanceof Error ? err.message : String(err))) this.notify()
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

  private withLocalOwnership(result: Extract<TerminalAttachResult, { ok: true }>): Extract<
    TerminalAttachResult,
    { ok: true }
  > & {
    role: TerminalOwnershipViewModel['role']
    controllerStatus: TerminalOwnershipViewModel['controllerStatus']
  } {
    const attachmentId = readOrCreateWebTerminalAttachmentId()
    return {
      ...result,
      ...resolveTerminalOwnership(result.controller, attachmentId),
    }
  }

  private async replayActiveView(
    token: number,
    term: XTermTerminal,
    replay: string,
    replaySeq: number,
    replayTruncated: boolean,
  ): Promise<void> {
    this.runtime.beginReplay(replaySeq)
    try {
      if (replayTruncated) term.reset()
      if (replay) term.write(replay)
      await waitForTerminalResponseFlush()
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
      if (hydratedSnapshot.snapshot) term.write(hydratedSnapshot.snapshot)
      await waitForTerminalResponseFlush()
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
    this.cancelResizeFlush()
    this.resizeFlushTimer = window.setTimeout(() => {
      this.resizeFlushTimer = null
      this.flushResize()
    }, RESIZE_DEBOUNCE_MS)
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
      .catch(() => {})
  }

  private cancelResizeFlush(): void {
    if (this.resizeFlushTimer === null) return
    window.clearTimeout(this.resizeFlushTimer)
    this.resizeFlushTimer = null
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

  private destroyActiveView(): void {
    this.cancelResizeFlush()
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    this.pendingResize = null
    this.pendingOutput = []
    this.startToken += 1
    this.runtime.resetTransientState()
    this.view.destroyTerminal()
  }

  private currentStart(token: number, term: XTermTerminal): boolean {
    return !this.disposed && this.startToken === token && this.view.currentTerminal() === term
  }

  private currentToken(token: number): boolean {
    return !this.disposed && this.startToken === token
  }

  private updateProgress(state: number, value: number): void {
    if (this.runtime.setProgress(state, value)) this.notify()
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
    if (this.runtime.setSearchResult(result)) this.notify()
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

function waitForTerminalResponseFlush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), 0)
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
