import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import { FitAddon } from '@xterm/addon-fit'
import type { ImageAddon as XTermImageAddon } from '@xterm/addon-image'
import { ImageAddon } from '@xterm/addon-image'
import type { ProgressAddon as XTermProgressAddon } from '@xterm/addon-progress'
import { ProgressAddon } from '@xterm/addon-progress'
import type { SearchAddon as XTermSearchAddon, ISearchOptions, ISearchResultChangeEvent } from '@xterm/addon-search'
import { SearchAddon } from '@xterm/addon-search'
import type { SerializeAddon as XTermSerializeAddon } from '@xterm/addon-serialize'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ITheme } from '@xterm/xterm'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'
import {
  observeTerminalTheme,
  terminalSearchDecorationsForCurrentDocument,
  terminalThemeForCurrentDocument,
} from '#/web/components/terminal/terminal-theme.ts'
import { isMacNavigatorPlatform, terminalInputForMacOptionArrow } from '#/web/components/terminal/terminal-keyboard.ts'
const DEFAULT_PARKING_WIDTH = 800
const DEFAULT_PARKING_HEIGHT = 400
const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24
const RESIZE_DEBOUNCE_MS = 80
const FONT_REMEASURE_DEBOUNCE_MS = 80
const TERMINAL_FONT_FAMILY = "'Goblin Mono', monospace"

export class TerminalSessionView {
  private readonly frame: HTMLDivElement
  private readonly xtermHost: HTMLDivElement
  private readonly parkingElement: HTMLDivElement
  private term: XTermTerminal | null = null
  private fitAddon: XTermFitAddon | null = null
  private searchAddon: XTermSearchAddon | null = null
  private serializeAddon: XTermSerializeAddon | null = null
  private imageAddon: XTermImageAddon | null = null
  private progressAddon: XTermProgressAddon | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposables: Array<{ dispose: () => void }> = []
  private disposeThemeObserver: (() => void) | null = null
  private disposeFontObserver: (() => void) | null = null
  private fitFlushTimer: number | null = null
  private fontFitTimer: number | null = null
  private pinToBottomFrame: number | null = null
  private lastWidth = DEFAULT_PARKING_WIDTH
  private lastHeight = DEFAULT_PARKING_HEIGHT
  private host: HTMLElement | null = null

  constructor(handlers: {
    onInput: (data: string) => void
    onBell: () => void
    onResize: (size: { cols: number; rows: number }) => void
    onSearchResult: (event: ISearchResultChangeEvent) => void
    onProgress: (state: number, value: number) => void
    onOpenExternalLink: (uri: string) => void
  }) {
    this.frame = document.createElement('div')
    this.frame.className = 'goblin-managed-terminal-frame'
    this.xtermHost = document.createElement('div')
    this.xtermHost.className = 'goblin-managed-terminal-host'
    this.frame.appendChild(this.xtermHost)
    this.parkingElement = document.createElement('div')
    this.parkingElement.className = 'goblin-terminal-parking__item'
    this.updateParkingSize()
    this.handlers = handlers
  }

  private readonly handlers: {
    onInput: (data: string) => void
    onBell: () => void
    onResize: (size: { cols: number; rows: number }) => void
    onSearchResult: (event: ISearchResultChangeEvent) => void
    onProgress: (state: number, value: number) => void
    onOpenExternalLink: (uri: string) => void
  }

  attach(host: HTMLElement): void {
    this.host = host
    this.rememberHostSize(host)
    host.replaceChildren(this.frame)
    if (this.term) {
      this.installResizeObserver()
      this.fitSoon()
    }
  }

  isConnected(): boolean {
    return this.frame.isConnected
  }

  detach(host: HTMLElement, parkingRoot: HTMLElement): void {
    if (this.host !== host) return
    this.host = null
    this.blurIfFocused()
    this.rememberHostSize(host)
    this.updateParkingSize()
    this.disconnectResizeObserver()
    this.cancelFitFlush()
    if (!this.parkingElement.parentElement) parkingRoot.appendChild(this.parkingElement)
    this.parkingElement.replaceChildren(this.frame)
  }

  disposeFrame(): void {
    this.parkingElement.remove()
    this.frame.remove()
  }

  isTerminalFocusTarget(target: EventTarget | null): boolean {
    return target instanceof Node && !!this.term?.element?.contains(target)
  }

  isVisible(): boolean {
    return !!this.host?.isConnected
  }

  blurIfFocused(): void {
    blurElementIfFocused(this.frame)
  }

  openTerminal(onMacOptionInput: (input: string) => void): XTermTerminal {
    const theme = terminalThemeForCurrentDocument()
    const term = new Terminal({
      allowProposedApi: true,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.35,
      minimumContrastRatio: 4.5,
      scrollback: 10_000,
      macOptionIsMeta: true,
      rescaleOverlappingGlyphs: true,
      scrollOnUserInput: true,
      theme,
    })
    const fitAddon = new FitAddon()
    this.term = term
    this.fitAddon = fitAddon
    term.loadAddon(fitAddon)
    this.installOptionalAddons(term)
    this.installKeyboardHandlers(term, onMacOptionInput)
    this.applyTerminalTheme(term, theme)
    this.disposeThemeObserver = observeTerminalTheme((nextTheme) => {
      this.applyTerminalTheme(term, nextTheme)
    })
    this.disposables.push(term.onData((data) => this.handlers.onInput(data)))
    this.disposables.push(term.onBinary((data) => this.handlers.onInput(data)))
    this.disposables.push(term.onBell(() => this.handlers.onBell()))
    this.disposables.push(term.onResize((size) => this.handlers.onResize(size)))
    term.open(this.xtermHost)
    this.installResizeObserver()
    this.installFontObserver(term)
    return term
  }

  currentTerminal(): XTermTerminal | null {
    return this.term
  }

  focus(): void {
    this.term?.focus()
  }

  resizeTo(cols: number, rows: number): void {
    if (!this.term) return
    if (this.term.cols === cols && this.term.rows === rows) return
    this.term.resize(cols, rows)
    this.pinToBottomSoon()
  }

  serialize(): string {
    return this.serializeAddon?.serialize({ excludeAltBuffer: true }) ?? ''
  }

  clearSearch(): void {
    this.searchAddon?.clearDecorations()
  }

  scrollToBottom(): void {
    scrollTerminalToBottom(this.term)
  }

  scrollLines(amount: number): void {
    this.term?.scrollLines(amount)
  }

  find(term: string, direction: 'next' | 'previous', incremental: boolean): boolean {
    if (!term || !this.searchAddon) {
      this.clearSearch()
      return false
    }
    return direction === 'next'
      ? this.searchAddon.findNext(term, terminalSearchOptions(incremental))
      : this.searchAddon.findPrevious(term, terminalSearchOptions())
  }

  fitSoon(): void {
    if (!this.term || !this.fitAddon || !hasMeasurableBox(this.xtermHost)) return
    const dimensions = this.fitAddon.proposeDimensions()
    if (!dimensions || (dimensions.cols === this.term.cols && dimensions.rows === this.term.rows)) return
    this.cancelFitFlush()
    this.fitFlushTimer = window.setTimeout(() => {
      this.fitFlushTimer = null
      this.fitNow()
    }, RESIZE_DEBOUNCE_MS)
  }

  fitNow(): void {
    if (!this.term || !this.fitAddon || !hasMeasurableBox(this.xtermHost)) return
    this.fitAddon.fit()
    this.pinToBottomSoon()
  }

  destroyTerminal(): void {
    this.disconnectResizeObserver()
    this.cancelFitFlush()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    this.disposeThemeObserver?.()
    this.disposeThemeObserver = null
    this.disposeFontObserver?.()
    this.disposeFontObserver = null
    this.cancelFontFit()
    this.cancelPinToBottom()
    this.fitAddon = null
    this.searchAddon = null
    this.serializeAddon = null
    this.imageAddon = null
    this.progressAddon = null
    this.term?.dispose()
    this.term = null
    this.xtermHost.replaceChildren()
    if (!this.frame.contains(this.xtermHost)) this.frame.appendChild(this.xtermHost)
  }

  private installKeyboardHandlers(term: XTermTerminal, onMacOptionInput: (input: string) => void): void {
    const isMac = isMacNavigatorPlatform(globalThis.navigator?.platform ?? '')
    term.attachCustomKeyEventHandler((event) => {
      const input = terminalInputForMacOptionArrow(event, {
        isMac,
        applicationCursorKeysMode: term.modes.applicationCursorKeysMode,
      })
      if (!input) return true
      event.preventDefault()
      event.stopPropagation()
      onMacOptionInput(input)
      return false
    })
  }

  private installOptionalAddons(term: XTermTerminal): void {
    this.installUnicode11Addon(term)
    this.installWebLinksAddon(term)
    this.installSearchAddon(term)
    this.installSerializeAddon(term)
    this.installImageAddon(term)
    this.installProgressAddon(term)
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
      term.loadAddon(new WebLinksAddon((_event, uri) => this.handlers.onOpenExternalLink(uri)))
    } catch (err) {
      console.warn('[terminal] failed to load web links addon', err)
    }
  }

  private installSearchAddon(term: XTermTerminal): void {
    try {
      const searchAddon = new SearchAddon({ highlightLimit: 1000 })
      term.loadAddon(searchAddon)
      this.disposables.push(searchAddon.onDidChangeResults((event) => this.handlers.onSearchResult(event)))
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

  private installImageAddon(term: XTermTerminal): void {
    try {
      const imageAddon = new ImageAddon()
      term.loadAddon(imageAddon)
      this.imageAddon = imageAddon
    } catch (err) {
      console.warn('[terminal] failed to load image addon', err)
    }
  }

  private installProgressAddon(term: XTermTerminal): void {
    try {
      const progressAddon = new ProgressAddon()
      term.loadAddon(progressAddon)
      this.disposables.push(progressAddon.onChange(({ state, value }) => this.handlers.onProgress(state, value)))
      this.progressAddon = progressAddon
    } catch (err) {
      console.warn('[terminal] failed to load progress addon', err)
    }
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

  private installFontObserver(term: XTermTerminal): void {
    this.disposeFontObserver?.()
    this.disposeFontObserver = null
    const fonts = document.fonts
    if (!fonts) return
    const refit = () => this.scheduleFontFit(term)
    fonts.ready.then(refit).catch(() => {})
    fonts.addEventListener?.('loadingdone', refit)
    this.disposeFontObserver = () => {
      fonts.removeEventListener?.('loadingdone', refit)
    }
  }

  private disconnectResizeObserver(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
  }

  private scheduleFontFit(term: XTermTerminal): void {
    if (this.term !== term) return
    this.cancelFontFit()
    this.fontFitTimer = window.setTimeout(() => {
      this.fontFitTimer = null
      this.fitForFontLoad(term)
    }, FONT_REMEASURE_DEBOUNCE_MS)
  }

  private cancelFontFit(): void {
    if (this.fontFitTimer === null) return
    window.clearTimeout(this.fontFitTimer)
    this.fontFitTimer = null
  }

  private fitForFontLoad(term: XTermTerminal): void {
    if (this.term !== term || !this.fitAddon || !hasMeasurableBox(this.xtermHost)) return
    remeasureTerminal(term)
    this.fitAddon.fit()
    term.refresh(0, Math.max(0, term.rows - 1))
    this.pinToBottomSoon()
  }

  private cancelFitFlush(): void {
    if (this.fitFlushTimer === null) return
    window.clearTimeout(this.fitFlushTimer)
    this.fitFlushTimer = null
  }

  private pinToBottomSoon(): void {
    if (!this.term) return
    // Product policy: after any local terminal resize/fit pass, always snap
    // back to the live tail instead of preserving scroll position.
    this.cancelPinToBottom()
    this.pinToBottomFrame = requestAnimationFrame(() => {
      this.pinToBottomFrame = null
      scrollTerminalToBottom(this.term)
    })
  }

  private cancelPinToBottom(): void {
    if (this.pinToBottomFrame === null) return
    cancelScheduledAnimationFrame(this.pinToBottomFrame)
    this.pinToBottomFrame = null
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
}

function terminalSearchOptions(incremental?: boolean): ISearchOptions {
  return {
    caseSensitive: false,
    decorations: terminalSearchDecorationsForCurrentDocument(),
    ...(incremental === undefined ? {} : { incremental }),
  }
}

function blurElementIfFocused(element: HTMLElement): void {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && element.contains(activeElement)) activeElement.blur()
}

function hasMeasurableBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function remeasureTerminal(term: XTermTerminal): void {
  const internal = term as XTermTerminal & {
    _core?: {
      _charSizeService?: { measure?: () => void }
      _renderService?: { clear?: () => void }
    }
  }
  internal._core?._charSizeService?.measure?.()
  internal._core?._renderService?.clear?.()
}

function scrollTerminalToBottom(term: XTermTerminal | null): void {
  if (!term) return
  term.scrollToBottom()
}

function cancelScheduledAnimationFrame(frame: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  else clearTimeout(frame)
}
