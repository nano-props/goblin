import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { ProgressAddon } from '@xterm/addon-progress'
import type { SearchAddon as XTermSearchAddon, ISearchOptions, ISearchResultChangeEvent } from '@xterm/addon-search'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ILinkHandler, ITheme } from '@xterm/xterm'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'
import { createTerminalSizingOptions } from '#/web/components/terminal/terminal-geometry.ts'
import {
  observeTerminalTheme,
  terminalSearchDecorationsForCurrentDocument,
  terminalThemeForCurrentDocument,
} from '#/web/components/terminal/terminal-theme.ts'
import {
  SafariShiftKeyResolver,
  isMacNavigatorPlatform,
  terminalInputForMacOptionArrow,
} from '#/web/components/terminal/terminal-keyboard.ts'
import { terminalLog } from '#/web/logger.ts'
import { constrainTerminalSize } from '#/shared/terminal-validators.ts'
import type { TerminalSize } from '#/shared/terminal-types.ts'
import type { TerminalFocusRequest } from '#/web/components/terminal/types.ts'

export class TerminalSessionView {
  private readonly frame: HTMLDivElement
  private readonly xtermHost: HTMLDivElement
  private term: XTermTerminal | null = null
  private fitAddon: XTermFitAddon | null = null
  private searchAddon: XTermSearchAddon | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposables: Array<{ dispose: () => void }> = []
  private disposeThemeObserver: (() => void) | null = null
  private disposeFontObserver: (() => void) | null = null
  private host: HTMLElement | null = null
  private presentationState: 'pending' | 'presented' = 'pending'
  private pendingFocusRequest: TerminalFocusRequest | null = null
  private readonly safariShiftKeyResolver = new SafariShiftKeyResolver()

  constructor(handlers: {
    onInput: (data: string) => void
    onResize: (size: { cols: number; rows: number }) => void
    onLayout: () => void
    onSearchResult: (event: ISearchResultChangeEvent) => void
    onProgress: (state: number, value: number) => void
    onOpenExternalLink: (uri: string) => void
  }) {
    this.frame = document.createElement('div')
    this.frame.className = 'goblin-managed-terminal-frame'
    this.xtermHost = document.createElement('div')
    this.xtermHost.className = 'goblin-managed-terminal-host'
    this.frame.appendChild(this.xtermHost)
    this.handlers = handlers
  }

  private readonly handlers: {
    onInput: (data: string) => void
    onResize: (size: { cols: number; rows: number }) => void
    onLayout: () => void
    onSearchResult: (event: ISearchResultChangeEvent) => void
    onProgress: (state: number, value: number) => void
    onOpenExternalLink: (uri: string) => void
  }

  attach(host: HTMLElement): void {
    this.host = host
    host.replaceChildren(this.frame)
    this.installResizeObserver()
    this.handlers.onLayout()
  }

  isConnected(): boolean {
    return this.frame.isConnected
  }

  detach(host: HTMLElement): boolean {
    if (this.host !== host) return false
    this.host = null
    this.markPresentationPending()
    this.blurIfFocused()
    this.disconnectResizeObserver()
    this.frame.remove()
    return true
  }

  disposeFrame(): void {
    this.host = null
    this.markPresentationPending()
    this.blurIfFocused()
    this.disconnectResizeObserver()
    this.frame.remove()
  }

  isVisible(): boolean {
    return this.presentationState === 'presented' && !!this.host?.isConnected
  }

  canOpenTerminal(): boolean {
    return this.term === null && !!this.host?.isConnected && hasMeasurableBox(this.xtermHost)
  }

  private markPresentationPending(): void {
    this.presentationState = 'pending'
    this.frame.style.visibility = 'hidden'
  }

  isPresented(): boolean {
    return this.presentationState === 'presented'
  }

  takeFocusRequestForRebuild(): TerminalFocusRequest | null {
    const pending = this.pendingFocusRequest
    if (pending) {
      let isCurrent: boolean
      try {
        isCurrent = pending.isCurrent()
      } catch (error) {
        this.settleFocusRequest()
        throw error
      }
      if (!isCurrent) {
        this.settleFocusRequest()
        return null
      }
      this.pendingFocusRequest = null
      return pending
    }
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement) || !this.frame.contains(activeElement)) return null
    const ownerDocument = this.frame.ownerDocument
    return transferredTerminalFocusRequest(ownerDocument)
  }

  async present(term: XTermTerminal, signal: AbortSignal): Promise<'presented' | 'layout-changed' | 'cancelled'> {
    if (this.term !== term || !this.host?.isConnected) return 'cancelled'
    if (!(await waitForFullViewportRender(term, signal))) return 'cancelled'
    if (this.term !== term || !this.host?.isConnected) return 'cancelled'
    const dimensions = this.proposedProtocolSize()
    if (!dimensions || dimensions.cols !== term.cols || dimensions.rows !== term.rows) return 'layout-changed'
    this.presentationState = 'presented'
    this.frame.style.visibility = ''
    this.commitFocusRequest(term)
    return 'presented'
  }

  blurIfFocused(): void {
    this.settleFocusRequest()
    blurElementIfFocused(this.frame)
  }

  openTerminal(onMacOptionInput: (data: string) => void): XTermTerminal {
    this.markPresentationPending()
    const theme = terminalThemeForCurrentDocument()
    const term = new Terminal({
      ...createTerminalSizingOptions(),
      cursorBlink: true,
      cursorStyle: 'bar',
      minimumContrastRatio: 4.5,
      linkHandler: this.createLinkHandler(),
      macOptionIsMeta: true,
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
    this.disposables.push(term.onResize((size) => this.handlers.onResize(size)))
    term.open(this.xtermHost)
    this.installFontObserver(term)
    return term
  }

  currentTerminal(): XTermTerminal | null {
    return this.term
  }

  focus(request?: TerminalFocusRequest): void {
    this.settleFocusRequest()
    const next = request ?? { isCurrent: () => true }
    try {
      if (!next.isCurrent()) {
        next.onSettled?.()
        return
      }
    } catch (error) {
      next.onSettled?.()
      throw error
    }
    this.pendingFocusRequest = next
    if (this.term && this.presentationState === 'presented') this.commitFocusRequest(this.term)
  }

  clearSearch(): void {
    this.searchAddon?.clearDecorations()
  }

  scrollToBottom(): void {
    this.term?.scrollToBottom()
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

  fitNow(): boolean {
    if (!this.term || !this.fitAddon || !hasMeasurableBox(this.xtermHost)) return false
    const dimensions = this.proposedProtocolSize()
    if (!dimensions) return false
    if (this.term.cols !== dimensions.cols || this.term.rows !== dimensions.rows) {
      this.term.resize(dimensions.cols, dimensions.rows)
    }
    return this.term.cols === dimensions.cols && this.term.rows === dimensions.rows
  }

  private proposedProtocolSize(): TerminalSize | null {
    const dimensions = this.fitAddon?.proposeDimensions()
    return dimensions ? constrainTerminalSize(dimensions.cols, dimensions.rows) : null
  }

  destroyTerminal(): void {
    this.markPresentationPending()
    this.settleFocusRequest()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    this.disposeThemeObserver?.()
    this.disposeThemeObserver = null
    this.disposeFontObserver?.()
    this.disposeFontObserver = null
    this.safariShiftKeyResolver.reset()
    this.fitAddon = null
    this.searchAddon = null
    this.term?.dispose()
    this.term = null
    this.xtermHost.replaceChildren()
    if (!this.frame.contains(this.xtermHost)) this.frame.appendChild(this.xtermHost)
  }

  private installKeyboardHandlers(term: XTermTerminal, onInput: (data: string) => void): void {
    const isMac = isMacNavigatorPlatform(globalThis.navigator?.platform ?? '')
    const safariShiftKeyResolver = this.safariShiftKeyResolver
    term.attachCustomKeyEventHandler((event) => {
      const optionInput = terminalInputForMacOptionArrow(event, {
        isMac,
        applicationCursorKeysMode: term.modes.applicationCursorKeysMode,
      })
      if (optionInput) {
        event.preventDefault()
        event.stopPropagation()
        this.sendInterceptedKeyboardInput(term, optionInput, onInput)
        return false
      }
      const safariShiftInput = safariShiftKeyResolver.inputForEvent(event)
      if (safariShiftInput) {
        event.preventDefault()
        event.stopPropagation()
        this.sendInterceptedKeyboardInput(term, safariShiftInput, onInput)
        return false
      }
      return true
    })
  }

  private sendInterceptedKeyboardInput(term: XTermTerminal, data: string, onInput: (data: string) => void): void {
    if (term.options.scrollOnUserInput) term.scrollToBottom()
    onInput(data)
  }

  private installOptionalAddons(term: XTermTerminal): void {
    this.installUnicode11Addon(term)
    this.installWebLinksAddon(term)
    this.installSearchAddon(term)
    this.installImageAddon(term)
    this.installProgressAddon(term)
  }

  private installUnicode11Addon(term: XTermTerminal): void {
    try {
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
    } catch (err) {
      terminalLog.warn('failed to load unicode11 addon', { err })
    }
  }

  private installWebLinksAddon(term: XTermTerminal): void {
    try {
      term.loadAddon(new WebLinksAddon((_event, uri) => this.handlers.onOpenExternalLink(uri)))
    } catch (err) {
      terminalLog.warn('failed to load web links addon', { err })
    }
  }

  private createLinkHandler(): ILinkHandler {
    return {
      allowNonHttpProtocols: false,
      activate: (event, uri) => {
        event.preventDefault()
        this.handlers.onOpenExternalLink(uri)
      },
    }
  }

  private installSearchAddon(term: XTermTerminal): void {
    try {
      const searchAddon = new SearchAddon({ highlightLimit: 1000 })
      term.loadAddon(searchAddon)
      this.disposables.push(searchAddon.onDidChangeResults((event) => this.handlers.onSearchResult(event)))
      this.searchAddon = searchAddon
    } catch (err) {
      terminalLog.warn('failed to load search addon', { err })
    }
  }

  private installImageAddon(term: XTermTerminal): void {
    try {
      const imageAddon = new ImageAddon()
      term.loadAddon(imageAddon)
    } catch (err) {
      terminalLog.warn('failed to load image addon', { err })
    }
  }

  private installProgressAddon(term: XTermTerminal): void {
    try {
      const progressAddon = new ProgressAddon()
      term.loadAddon(progressAddon)
      this.disposables.push(progressAddon.onChange(({ state, value }) => this.handlers.onProgress(state, value)))
    } catch (err) {
      terminalLog.warn('failed to load progress addon', { err })
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
    this.resizeObserver = new ResizeObserver(() => this.handlers.onLayout())
    this.resizeObserver.observe(this.xtermHost)
  }

  private installFontObserver(term: XTermTerminal): void {
    this.disposeFontObserver?.()
    this.disposeFontObserver = null
    const fonts = document.fonts
    if (!fonts) return
    const refit = () => {
      if (this.term === term) this.handlers.onLayout()
    }
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

  private settleFocusRequest(): void {
    const pending = this.pendingFocusRequest
    this.pendingFocusRequest = null
    pending?.onSettled?.()
  }

  private commitFocusRequest(term: XTermTerminal): void {
    const pending = this.pendingFocusRequest
    if (!pending) return
    this.pendingFocusRequest = null
    try {
      if (pending.isCurrent()) term.focus()
    } finally {
      pending.onSettled?.()
    }
  }
}

function waitForFullViewportRender(term: XTermTerminal, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (rendered: boolean) => {
      if (settled) return
      settled = true
      disposable.dispose()
      signal.removeEventListener('abort', onAbort)
      resolve(rendered)
    }
    const onAbort = () => finish(false)
    const disposable = term.onRender(({ start, end }) => {
      if (start === 0 && end >= term.rows - 1) finish(true)
    })
    signal.addEventListener('abort', onAbort, { once: true })
    term.refresh(0, term.rows - 1)
  })
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

function documentFocusIsNeutral(ownerDocument: Document): boolean {
  return (
    ownerDocument.activeElement === null ||
    ownerDocument.activeElement === ownerDocument.body ||
    ownerDocument.activeElement === ownerDocument.documentElement
  )
}

function transferredTerminalFocusRequest(ownerDocument: Document): TerminalFocusRequest {
  let current = true
  let observing = false
  const ownerWindow = ownerDocument.defaultView
  const abandon = () => {
    current = false
  }
  const abandonForKeyboardNavigation = (event: KeyboardEvent) => {
    if (event.key === 'Tab') abandon()
  }
  const stopObserving = () => {
    if (!observing) return
    observing = false
    ownerDocument.removeEventListener('pointerdown', abandon, true)
    ownerDocument.removeEventListener('keydown', abandonForKeyboardNavigation, true)
    ownerWindow?.removeEventListener('blur', abandon)
  }
  const startObserving = () => {
    if (observing) return
    observing = true
    ownerDocument.addEventListener('pointerdown', abandon, true)
    ownerDocument.addEventListener('keydown', abandonForKeyboardNavigation, true)
    ownerWindow?.addEventListener('blur', abandon)
  }
  return {
    isCurrent: () => {
      startObserving()
      return current && documentFocusIsNeutral(ownerDocument)
    },
    onSettled: () => {
      current = false
      stopObserving()
    },
  }
}

function hasMeasurableBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
