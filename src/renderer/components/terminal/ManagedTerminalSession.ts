import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon as XTermSearchAddon, ISearchOptions, ISearchResultChangeEvent } from '@xterm/addon-search'
import { SearchAddon } from '@xterm/addon-search'
import type { SerializeAddon as XTermSerializeAddon } from '@xterm/addon-serialize'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ITheme } from '@xterm/xterm'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalExitEvent,
  TerminalOpenInput,
  TerminalOutputEvent,
  TerminalRestartInput,
} from '#/shared/terminal.ts'
import { terminalBridge } from '#/renderer/terminal.ts'
import { setTerminalFocused } from '#/renderer/terminal-focus.ts'
import { rpc } from '#/renderer/rpc.ts'
import {
  observeTerminalTheme,
  terminalSearchDecorationsForCurrentDocument,
  terminalThemeForCurrentDocument,
} from '#/renderer/components/terminal/terminal-theme.ts'
import type {
  TerminalDescriptor,
  TerminalPhase,
  TerminalSearchResult,
  TerminalSnapshot,
} from '#/renderer/components/terminal/types.ts'

const DEFAULT_PARKING_WIDTH = 800
const DEFAULT_PARKING_HEIGHT = 400
const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24
const RESIZE_DEBOUNCE_MS = 80
const EMPTY_SEARCH_RESULT: TerminalSearchResult = { resultIndex: -1, resultCount: 0, found: false }

export class ManagedTerminalSession {
  descriptor: TerminalDescriptor
  private readonly notify: () => void
  private readonly frame: HTMLDivElement
  private readonly xtermHost: HTMLDivElement
  private readonly parkingElement: HTMLDivElement
  private term: XTermTerminal | null = null
  private fitAddon: XTermFitAddon | null = null
  private searchAddon: XTermSearchAddon | null = null
  private serializeAddon: XTermSerializeAddon | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposables: Array<{ dispose: () => void }> = []
  private ptySessionId: string | null = null
  private host: HTMLElement | null = null
  private phase: TerminalPhase = 'opening'
  private message: string | null = null
  private suppressData = false
  private replayBoundarySeq: number | null = null
  private replayPendingOutput: TerminalOutputEvent[] = []
  private startToken = 0
  private restartOnStart = false
  private replacingPtySessionId: string | null = null
  private fitFlushTimer: number | null = null
  private resizeFlushTimer: number | null = null
  private outputFlushFrame: number | null = null
  private pendingResize: { cols: number; rows: number } | null = null
  private pendingOutput: string[] = []
  private disposeThemeObserver: (() => void) | null = null
  private disposed = false
  private lastWidth = DEFAULT_PARKING_WIDTH
  private lastHeight = DEFAULT_PARKING_HEIGHT
  private lastPtyCols = 0
  private lastPtyRows = 0
  private searchResult: TerminalSearchResult | null = null

  constructor(descriptor: TerminalDescriptor, notify: () => void) {
    this.descriptor = descriptor
    this.notify = notify
    this.frame = document.createElement('div')
    this.frame.className = 'goblin-managed-terminal-frame'
    this.xtermHost = document.createElement('div')
    this.xtermHost.className = 'goblin-managed-terminal-host'
    this.frame.appendChild(this.xtermHost)
    this.parkingElement = document.createElement('div')
    this.parkingElement.className = 'goblin-terminal-parking__item'
    this.updateParkingSize()
  }

  updateDescriptor(descriptor: TerminalDescriptor): void {
    this.descriptor = descriptor
  }

  attach(host: HTMLElement): void {
    if (this.disposed) return
    this.host = host
    this.rememberHostSize(host)
    host.replaceChildren(this.frame)
    if (this.term) {
      this.installResizeObserver()
      this.fitSoon()
    }
    this.start()
    if (this.phase === 'open') this.term?.focus()
  }

  detach(host: HTMLElement, parkingRoot: HTMLElement): void {
    if (this.host !== host) return
    this.host = null
    this.clearTerminalFocusIfOwned()
    this.blurIfFocused()
    this.rememberHostSize(host)
    this.updateParkingSize()
    this.disconnectResizeObserver()
    this.cancelFitFlush()
    if (!this.parkingElement.parentElement) parkingRoot.appendChild(this.parkingElement)
    this.parkingElement.replaceChildren(this.frame)
  }

  restart(): void {
    if (this.disposed) return
    const oldPtySessionId = this.ptySessionId
    this.ptySessionId = null
    if (oldPtySessionId) this.replacingPtySessionId = oldPtySessionId
    this.restartOnStart = true
    this.destroyActiveView()
    this.setSnapshot('opening', null)
    this.start()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTerminalFocusIfOwned()
    this.blurIfFocused()
    const sessionIds = new Set([this.ptySessionId, this.replacingPtySessionId].filter((id): id is string => !!id))
    this.ptySessionId = null
    this.replacingPtySessionId = null
    for (const sessionId of sessionIds) void terminalBridge.close({ sessionId }).catch(() => {})
    this.destroyActiveView()
    this.parkingElement.remove()
    this.frame.remove()
  }

  snapshot(): TerminalSnapshot {
    const snapshot: TerminalSnapshot = { phase: this.phase, message: this.message }
    if (this.searchResult) snapshot.search = this.searchResult
    return snapshot
  }

  isTerminalFocusTarget(target: EventTarget | null): boolean {
    return target instanceof Node && !!this.term?.element?.contains(target)
  }

  writeInput(data: string): void {
    if (this.suppressData || !this.ptySessionId) return
    void terminalBridge.write({ sessionId: this.ptySessionId, data }).catch(() => {})
  }

  findNext(term: string, incremental = false): TerminalSearchResult {
    return this.find(term, 'next', incremental)
  }

  findPrevious(term: string): TerminalSearchResult {
    return this.find(term, 'previous', false)
  }

  clearSearch(): void {
    this.searchAddon?.clearDecorations()
    this.setSearchResult(null)
  }

  serialize(): string {
    return this.serializeAddon?.serialize({ excludeAltBuffer: true }) ?? ''
  }

  handleOutput(event: TerminalOutputEvent): void {
    if (event.sessionId !== this.ptySessionId) return
    if (this.replayBoundarySeq !== null) {
      this.replayPendingOutput.push(event)
      return
    }
    this.queueOutput(event.data)
  }

  handleExit(event: TerminalExitEvent): boolean {
    if (event.sessionId !== this.ptySessionId) return false
    this.flushOutput()
    this.ptySessionId = null
    this.clearTerminalFocusIfOwned()
    this.blurIfFocused()
    return true
  }

  private start(): void {
    if (this.disposed || this.term || !this.frame.isConnected) return
    const token = (this.startToken += 1)
    this.setSnapshot('opening', null)
    void this.startAsync(token)
  }

  private async startAsync(token: number): Promise<void> {
    let term: XTermTerminal | null = null
    try {
      if (this.disposed || this.startToken !== token || this.term) return
      const fitAddon = new FitAddon()
      term = this.createTerminal()
      this.term = term
      this.fitAddon = fitAddon
      term.loadAddon(fitAddon)
      term.open(this.xtermHost)
      this.installResizeObserver()
      await waitForTerminalLayout()
      if (!this.currentStart(token, term)) return
      const restart = this.restartOnStart
      this.fitNow()
      await waitForTerminalLayout()
      if (!this.currentStart(token, term)) return
      const result = restart
        ? await terminalBridge.restart(this.terminalRestartInput(term))
        : await terminalBridge.open(this.terminalOpenInput(term))
      if (!this.currentStart(token, term)) {
        if (result.ok) void terminalBridge.close({ sessionId: result.sessionId }).catch(() => {})
        else this.closeReplacingPtySession()
        return
      }
      this.restartOnStart = false
      if (!result.ok) {
        this.closeReplacingPtySession()
        this.destroyActiveView()
        this.setSnapshot('error', result.message)
        return
      }
      this.replacingPtySessionId = null
      this.ptySessionId = result.sessionId
      this.lastPtyCols = term.cols
      this.lastPtyRows = term.rows
      await this.replayActiveView(token, term, result.replay, result.replaySeq)
      if (!this.currentStart(token, term)) return
      this.setSnapshot('open', null)
      if (this.host) term.focus()
    } catch (err) {
      this.closeReplacingPtySession()
      if (!this.currentToken(token)) return
      this.destroyActiveView()
      this.setSnapshot('error', err instanceof Error ? err.message : String(err))
    }
  }

  private terminalOpenInput(term: XTermTerminal): TerminalOpenInput {
    return {
      repoRoot: this.descriptor.repoRoot,
      branch: this.descriptor.branch,
      worktreePath: this.descriptor.worktreePath,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private terminalRestartInput(term: XTermTerminal): TerminalRestartInput {
    return {
      repoRoot: this.descriptor.repoRoot,
      branch: this.descriptor.branch,
      worktreePath: this.descriptor.worktreePath,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private async replayActiveView(token: number, term: XTermTerminal, replay: string, replaySeq: number): Promise<void> {
    this.replayBoundarySeq = replaySeq
    this.replayPendingOutput = []
    this.suppressData = true
    try {
      if (replay) term.write(replay)
      await waitForTerminalResponseFlush()
    } finally {
      if (this.currentStart(token, term)) {
        const pendingOutput = this.replayPendingOutput.splice(0)
        this.replayBoundarySeq = null
        this.suppressData = false
        for (const event of outputAfterReplay(pendingOutput, replaySeq)) this.queueOutput(event.data)
      }
    }
  }

  private queueResize(cols: number, rows: number): void {
    if (!this.ptySessionId) return
    if (this.lastPtyCols === cols && this.lastPtyRows === rows && !this.pendingResize) return
    this.pendingResize = { cols, rows }
    this.cancelResizeFlush()
    this.resizeFlushTimer = window.setTimeout(() => {
      this.resizeFlushTimer = null
      this.flushResize()
    }, RESIZE_DEBOUNCE_MS)
  }

  private flushResize(): void {
    const sessionId = this.ptySessionId
    const resize = this.pendingResize
    this.pendingResize = null
    if (!sessionId || !resize) return
    const { cols, rows } = resize
    if (this.lastPtyCols === cols && this.lastPtyRows === rows) return
    this.lastPtyCols = cols
    this.lastPtyRows = rows
    void terminalBridge.resize({ sessionId, cols, rows }).catch(() => {})
  }

  private cancelResizeFlush(): void {
    if (this.resizeFlushTimer === null) return
    window.clearTimeout(this.resizeFlushTimer)
    this.resizeFlushTimer = null
  }

  private queueOutput(data: string): void {
    if (!this.term) return
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
    this.term?.write(output)
  }

  private destroyActiveView(): void {
    this.disconnectResizeObserver()
    this.cancelFitFlush()
    this.cancelResizeFlush()
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    this.pendingResize = null
    this.pendingOutput = []
    this.startToken += 1
    this.suppressData = false
    this.replayBoundarySeq = null
    this.replayPendingOutput = []
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    this.disposeThemeObserver?.()
    this.disposeThemeObserver = null
    this.fitAddon = null
    this.searchAddon = null
    this.serializeAddon = null
    this.searchResult = null
    this.term?.dispose()
    this.term = null
    this.xtermHost.replaceChildren()
    if (!this.frame.contains(this.xtermHost)) this.frame.appendChild(this.xtermHost)
  }

  private currentStart(token: number, term: XTermTerminal): boolean {
    return !this.disposed && this.startToken === token && this.term === term
  }

  private currentToken(token: number): boolean {
    return !this.disposed && this.startToken === token
  }

  private createTerminal(): XTermTerminal {
    const theme = terminalThemeForCurrentDocument()
    const term = new Terminal({
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', var(--font-mono)",
      fontSize: 14,
      lineHeight: 1.35,
      minimumContrastRatio: 4.5,
      scrollback: 10_000,
      macOptionIsMeta: true,
      scrollOnUserInput: true,
      theme,
    })
    this.installOptionalAddons(term)
    this.applyTerminalTheme(term, theme)
    this.disposeThemeObserver = observeTerminalTheme((theme) => {
      this.applyTerminalTheme(term, theme)
    })
    this.disposables.push(term.onData((data) => this.writeInput(data)))
    this.disposables.push(term.onBinary((data) => this.writeInput(data)))
    this.disposables.push(term.onResize(({ cols, rows }) => this.queueResize(cols, rows)))
    return term
  }

  private installOptionalAddons(term: XTermTerminal): void {
    this.installUnicode11Addon(term)
    this.installWebLinksAddon(term)
    this.installSearchAddon(term)
    this.installSerializeAddon(term)
  }

  private installUnicode11Addon(term: XTermTerminal): void {
    try {
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
    } catch (err) {
      console.warn('[terminal] failed to load unicode11 addon', err)
    }
  }

  private installWebLinksAddon(term: XTermTerminal): void {
    try {
      term.loadAddon(new WebLinksAddon((_event, uri) => this.openExternalLink(uri)))
    } catch (err) {
      console.warn('[terminal] failed to load web links addon', err)
    }
  }

  private installSearchAddon(term: XTermTerminal): void {
    try {
      const searchAddon = new SearchAddon({ highlightLimit: 1000 })
      term.loadAddon(searchAddon)
      this.disposables.push(searchAddon.onDidChangeResults((event) => this.updateSearchResult(event)))
      this.searchAddon = searchAddon
    } catch (err) {
      console.warn('[terminal] failed to load search addon', err)
    }
  }

  private installSerializeAddon(term: XTermTerminal): void {
    try {
      const serializeAddon = new SerializeAddon()
      term.loadAddon(serializeAddon)
      this.serializeAddon = serializeAddon
    } catch (err) {
      console.warn('[terminal] failed to load serialize addon', err)
    }
  }

  private find(term: string, direction: 'next' | 'previous', incremental: boolean): TerminalSearchResult {
    const searchTerm = term
    if (!searchTerm || !this.searchAddon) {
      this.clearSearch()
      return EMPTY_SEARCH_RESULT
    }
    const found =
      direction === 'next'
        ? this.searchAddon.findNext(searchTerm, terminalSearchOptions(incremental))
        : this.searchAddon.findPrevious(searchTerm, terminalSearchOptions())
    if (!found) this.setSearchResult(EMPTY_SEARCH_RESULT)
    return this.searchResult ?? { ...EMPTY_SEARCH_RESULT, found }
  }

  private updateSearchResult(event: ISearchResultChangeEvent): void {
    this.setSearchResult({
      resultIndex: event.resultIndex,
      resultCount: event.resultCount,
      found: event.resultCount > 0,
    })
  }

  private setSearchResult(result: TerminalSearchResult | null): void {
    this.searchResult = result
    this.notify()
  }

  private openExternalLink(uri: string): void {
    if (!isHttpExternalUrl(uri)) return
    void rpc.app.openExternalUrl.mutate({ url: uri }).catch((err) => {
      console.warn('[terminal] failed to open link', err)
    })
  }

  private applyTerminalTheme(term: XTermTerminal, theme: ITheme): void {
    term.options.theme = theme
    const background = typeof theme.background === 'string' ? theme.background : ''
    this.frame.style.background = background
    this.frame.style.setProperty('--goblin-terminal-background', background)
  }

  private installResizeObserver(): void {
    this.disconnectResizeObserver()
    this.resizeObserver = new ResizeObserver(() => this.fitSoon())
    this.resizeObserver.observe(this.xtermHost)
  }

  private disconnectResizeObserver(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
  }

  private fitSoon(): void {
    if (!this.term || !this.fitAddon || !hasMeasurableBox(this.xtermHost)) return
    const dimensions = this.fitAddon.proposeDimensions()
    if (!dimensions || (dimensions.cols === this.term.cols && dimensions.rows === this.term.rows)) return
    this.cancelFitFlush()
    this.fitFlushTimer = window.setTimeout(() => {
      this.fitFlushTimer = null
      this.fitNow()
    }, RESIZE_DEBOUNCE_MS)
  }

  private cancelFitFlush(): void {
    if (this.fitFlushTimer === null) return
    window.clearTimeout(this.fitFlushTimer)
    this.fitFlushTimer = null
  }

  private fitNow(): void {
    if (!this.term || !this.fitAddon || !hasMeasurableBox(this.xtermHost)) return
    this.fitAddon.fit()
  }

  private setSnapshot(phase: TerminalPhase, message: string | null): void {
    this.phase = phase
    this.message = message
    this.notify()
  }

  private rememberHostSize(host: HTMLElement): void {
    const rect = host.getBoundingClientRect()
    if (rect.width > 0) this.lastWidth = rect.width
    if (rect.height > 0) this.lastHeight = rect.height
  }

  private updateParkingSize(): void {
    this.parkingElement.style.width = `${this.lastWidth}px`
    this.parkingElement.style.height = `${this.lastHeight}px`
  }

  private blurIfFocused(): void {
    blurElementIfFocused(this.frame)
  }

  private clearTerminalFocusIfOwned(): void {
    if (this.isTerminalFocusTarget(document.activeElement)) setTerminalFocused(false)
  }

  private closeReplacingPtySession(): void {
    const sessionId = this.replacingPtySessionId
    this.replacingPtySessionId = null
    if (sessionId) void terminalBridge.close({ sessionId }).catch(() => {})
  }
}

function terminalSearchOptions(incremental?: boolean): ISearchOptions {
  return {
    caseSensitive: false,
    decorations: terminalSearchDecorationsForCurrentDocument(),
    ...(incremental === undefined ? {} : { incremental }),
  }
}

function outputAfterReplay(events: TerminalOutputEvent[], replaySeq: number): TerminalOutputEvent[] {
  return events.filter((event) => event.seq > replaySeq)
}

function blurElementIfFocused(element: HTMLElement): void {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && element.contains(activeElement)) activeElement.blur()
}

function waitForTerminalLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function hasMeasurableBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
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
