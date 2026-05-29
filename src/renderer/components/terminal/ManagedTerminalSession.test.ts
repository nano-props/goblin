// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ManagedTerminalSession } from '#/renderer/components/terminal/ManagedTerminalSession.ts'
import { installTerminalThemeStyles } from '#/renderer/components/terminal/terminal-theme-test-utils.ts'
import { isTerminalFocused } from '#/renderer/terminal-focus.ts'
import type { TerminalOpenResult } from '#/shared/terminal.ts'

const xtermMocks = vi.hoisted(() => {
  const terminals: any[] = []
  const fitAddons: any[] = []
  const searchAddons: any[] = []
  const serializeAddons: any[] = []
  const unicodeAddons: any[] = []
  const webLinkAddons: any[] = []
  const imageAddons: any[] = []
  const progressAddons: any[] = []
  const addonFailures = {
    search: false,
    serialize: false,
    unicode: false,
    webLinks: false,
    image: false,
    progress: false,
  }

  class MockTerminal {
    cols: number
    rows: number
    unicode = { activeVersion: '6' }
    options: {
      cursorBlink?: boolean
      macOptionIsMeta?: boolean
      minimumContrastRatio?: number
      theme?: { background?: string; foreground?: string }
      scrollOnUserInput?: boolean
    }
    element: HTMLDivElement | null = null
    modes = { applicationCursorKeysMode: false }
    write = vi.fn()
    reset = vi.fn()
    dispose = vi.fn()
    focus = vi.fn(() => this.textarea?.focus())
    customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null
    private textarea: HTMLTextAreaElement | null = null
    private resizeHandlers: Array<(size: { cols: number; rows: number }) => void> = []
    private dataHandlers: Array<(data: string) => void> = []
    private binaryHandlers: Array<(data: string) => void> = []
    private bellHandlers: Array<() => void> = []

    constructor(options: {
      cols: number
      rows: number
      cursorBlink?: boolean
      macOptionIsMeta?: boolean
      minimumContrastRatio?: number
      theme?: { background?: string; foreground?: string }
      scrollOnUserInput?: boolean
    }) {
      this.cols = options.cols
      this.rows = options.rows
      this.options = {
        cursorBlink: options.cursorBlink,
        macOptionIsMeta: options.macOptionIsMeta,
        minimumContrastRatio: options.minimumContrastRatio,
        theme: options.theme,
        scrollOnUserInput: options.scrollOnUserInput,
      }
      terminals.push(this)
    }

    loadAddon(addon: { activate?: (term: MockTerminal) => void }) {
      addon.activate?.(this)
    }

    open(host: HTMLElement) {
      this.element = document.createElement('div')
      this.element.className = 'xterm'
      this.textarea = document.createElement('textarea')
      this.element.appendChild(this.textarea)
      host.appendChild(this.element)
    }

    onData(cb: (data: string) => void) {
      this.dataHandlers.push(cb)
      return { dispose: vi.fn(() => (this.dataHandlers = this.dataHandlers.filter((handler) => handler !== cb))) }
    }

    onBinary(cb: (data: string) => void) {
      this.binaryHandlers.push(cb)
      return { dispose: vi.fn(() => (this.binaryHandlers = this.binaryHandlers.filter((handler) => handler !== cb))) }
    }

    onResize(cb: (size: { cols: number; rows: number }) => void) {
      this.resizeHandlers.push(cb)
      return { dispose: vi.fn(() => (this.resizeHandlers = this.resizeHandlers.filter((handler) => handler !== cb))) }
    }

    onBell(cb: () => void) {
      this.bellHandlers.push(cb)
      return { dispose: vi.fn(() => (this.bellHandlers = this.bellHandlers.filter((handler) => handler !== cb))) }
    }

    attachCustomKeyEventHandler(cb: (event: KeyboardEvent) => boolean) {
      this.customKeyEventHandler = cb
    }

    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      for (const handler of this.resizeHandlers) handler({ cols, rows })
    }

    emitData(data: string) {
      for (const handler of this.dataHandlers) handler(data)
    }

    emitBell() {
      for (const handler of this.bellHandlers) handler()
    }
  }

  class MockFitAddon {
    term: MockTerminal | null = null
    proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }))
    dispose = vi.fn()

    constructor() {
      fitAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }

    fit = vi.fn(() => {
      this.term?.resize(100, 30)
    })
  }

  class MockSearchAddon {
    term: MockTerminal | null = null
    private resultHandlers: Array<(event: { resultIndex: number; resultCount: number }) => void> = []
    clearDecorations = vi.fn()
    clearActiveDecoration = vi.fn()

    constructor(readonly options?: { highlightLimit?: number }) {
      if (addonFailures.search) throw new Error('search addon failed')
      searchAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }

    findNext = vi.fn((term: string) => this.emitSearch(term))
    findPrevious = vi.fn((term: string) => this.emitSearch(term))

    onDidChangeResults(cb: (event: { resultIndex: number; resultCount: number }) => void) {
      this.resultHandlers.push(cb)
      return { dispose: vi.fn(() => (this.resultHandlers = this.resultHandlers.filter((handler) => handler !== cb))) }
    }

    private emitSearch(term: string) {
      const found = term !== 'missing'
      const event = found ? { resultIndex: 0, resultCount: 2 } : { resultIndex: -1, resultCount: 0 }
      for (const handler of this.resultHandlers) handler(event)
      return found
    }
  }

  class MockSerializeAddon {
    term: MockTerminal | null = null
    serialize = vi.fn(() => 'serialized-output')
    serializeAsHTML = vi.fn(() => '<pre>serialized-output</pre>')

    constructor() {
      if (addonFailures.serialize) throw new Error('serialize addon failed')
      serializeAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }
  }

  class MockUnicode11Addon {
    term: MockTerminal | null = null

    constructor() {
      if (addonFailures.unicode) throw new Error('unicode addon failed')
      unicodeAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }
  }

  class MockWebLinksAddon {
    term: MockTerminal | null = null

    constructor(readonly handler?: (event: MouseEvent, uri: string) => void) {
      if (addonFailures.webLinks) throw new Error('web links addon failed')
      webLinkAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }

    open(uri: string) {
      this.handler?.(new MouseEvent('click'), uri)
    }
  }

  class MockImageAddon {
    term: MockTerminal | null = null

    constructor() {
      if (addonFailures.image) throw new Error('image addon failed')
      imageAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }
  }

  class MockProgressAddon {
    term: MockTerminal | null = null
    private changeHandlers: Array<(state: { state: number; value: number }) => void> = []

    constructor() {
      if (addonFailures.progress) throw new Error('progress addon failed')
      progressAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }

    onChange(cb: (state: { state: number; value: number }) => void) {
      this.changeHandlers.push(cb)
      return { dispose: vi.fn(() => (this.changeHandlers = this.changeHandlers.filter((h) => h !== cb))) }
    }

    emitProgress(state: number, value: number) {
      for (const handler of this.changeHandlers) handler({ state, value })
    }
  }

  return {
    terminals,
    fitAddons,
    searchAddons,
    serializeAddons,
    unicodeAddons,
    webLinkAddons,
    imageAddons,
    progressAddons,
    addonFailures,
    MockTerminal,
    MockFitAddon,
    MockSearchAddon,
    MockSerializeAddon,
    MockUnicode11Addon,
    MockWebLinksAddon,
    MockImageAddon,
    MockProgressAddon,
  }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xtermMocks.MockTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xtermMocks.MockFitAddon }))
vi.mock('@xterm/addon-image', () => ({ ImageAddon: xtermMocks.MockImageAddon }))
vi.mock('@xterm/addon-progress', () => ({ ProgressAddon: xtermMocks.MockProgressAddon }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: xtermMocks.MockSearchAddon }))
vi.mock('@xterm/addon-serialize', () => ({ SerializeAddon: xtermMocks.MockSerializeAddon }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: xtermMocks.MockUnicode11Addon }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: xtermMocks.MockWebLinksAddon }))

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  observe = vi.fn()
  disconnect = vi.fn()

  constructor(readonly cb: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this)
  }
}

const terminalCalls = {
  open: vi.fn<Window['goblin']['terminal']['open']>(),
  restart: vi.fn<Window['goblin']['terminal']['restart']>(),
  write: vi.fn<Window['goblin']['terminal']['write']>(),
  resize: vi.fn<Window['goblin']['terminal']['resize']>(),
  close: vi.fn<Window['goblin']['terminal']['close']>(),
  notifyBell: vi.fn<Window['goblin']['terminal']['notifyBell']>(),
}
const invokeRpc = vi.fn<Window['goblin']['invokeRpc']>()

const descriptor = {
  key: '/repo\0/worktree',
  groupKey: '/repo\0/worktree',
  terminalId: 'terminal-1',
  index: 1,
  repoRoot: '/repo',
  branch: 'feature',
  worktreePath: '/worktree',
}

beforeEach(() => {
  xtermMocks.terminals.length = 0
  xtermMocks.fitAddons.length = 0
  xtermMocks.searchAddons.length = 0
  xtermMocks.serializeAddons.length = 0
  xtermMocks.unicodeAddons.length = 0
  xtermMocks.webLinkAddons.length = 0
  xtermMocks.imageAddons.length = 0
  xtermMocks.progressAddons.length = 0
  Object.assign(xtermMocks.addonFailures, {
    search: false, serialize: false, unicode: false, webLinks: false,
    image: false, progress: false,
  })
  MockResizeObserver.instances.length = 0
  vi.clearAllMocks()
  installTerminalThemeStyles()
  document.documentElement.setAttribute('data-theme', 'light')
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0),
  })
  HTMLElement.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({
        width: 800,
        height: 400,
        top: 0,
        left: 0,
        bottom: 400,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  )
  Object.defineProperty(window, 'goblin', {
    configurable: true,
    value: {
      invokeRpc: invokeRpc.mockResolvedValue({ ok: true }),
      abortRpc: vi.fn(),
      homeDir: '/home',
      pathForFile: vi.fn(),
      onEvent: vi.fn(),
      terminal: {
        open: terminalCalls.open.mockResolvedValue(openResult('session-1')),
        restart: terminalCalls.restart.mockResolvedValue(openResult('session-2')),
        write: terminalCalls.write.mockResolvedValue(true),
        resize: terminalCalls.resize.mockResolvedValue(true),
        close: terminalCalls.close.mockResolvedValue(true),
        notifyBell: terminalCalls.notifyBell.mockResolvedValue(true),
        pruneRepo: vi.fn(),
        onOutput: vi.fn(),
        onExit: vi.fn(),
      },
    },
  })
})

describe('ManagedTerminalSession', () => {
  test('opens xterm and opens the main session with fitted dimensions', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
    expect(terminalCalls.open).toHaveBeenCalledWith({
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
      terminalId: 'terminal-1',
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals[0]!.options.minimumContrastRatio).toBe(4.5)
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
  })

  test('loads terminal addons and exposes search and serialization', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(xtermMocks.unicodeAddons).toHaveLength(1)
    expect(xtermMocks.terminals[0]!.unicode.activeVersion).toBe('11')
    expect(xtermMocks.webLinkAddons).toHaveLength(1)
    expect(xtermMocks.searchAddons).toHaveLength(1)
    expect(xtermMocks.serializeAddons).toHaveLength(1)
    expect(session.findNext('needle', true)).toEqual({ resultIndex: 0, resultCount: 2, found: true })
    expect(xtermMocks.searchAddons[0]!.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: true, caseSensitive: false }),
    )
    expect(session.findPrevious('needle')).toEqual({ resultIndex: 0, resultCount: 2, found: true })
    expect(session.findNext('missing')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    expect(session.serialize()).toBe('serialized-output')
    session.clearSearch()
    expect(xtermMocks.searchAddons[0]!.clearDecorations).toHaveBeenCalled()
    expect(session.snapshot().search).toBeUndefined()
  })

  test('handles mac option arrows with VS Code-like terminal input', async () => {
    const savedPlatform = navigator.platform
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSession(descriptor, vi.fn())

      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const term = xtermMocks.terminals[0]!
      expect(term.options.macOptionIsMeta).toBe(true)
      expect(term.customKeyEventHandler).toBeTypeOf('function')

      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowRight'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowUp'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowDown'))).toBe(false)
      await Promise.resolve()

      expect(terminalCalls.write).toHaveBeenNthCalledWith(1, { sessionId: 'session-1', data: '\x1bb' })
      expect(terminalCalls.write).toHaveBeenNthCalledWith(2, { sessionId: 'session-1', data: '\x1bf' })
      expect(terminalCalls.write).toHaveBeenNthCalledWith(3, { sessionId: 'session-1', data: '\x1b[A' })
      expect(terminalCalls.write).toHaveBeenNthCalledWith(4, { sessionId: 'session-1', data: '\x1b[B' })

      term.modes.applicationCursorKeysMode = true
      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(true)
      expect(terminalCalls.write).toHaveBeenCalledTimes(4)
    } finally {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value: savedPlatform })
    }
  })

  test('opens web links through the safe app rpc', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/path')
    await Promise.resolve()

    expect(invokeRpc).toHaveBeenCalledWith({
      path: 'app.openExternalUrl',
      input: { url: 'https://example.com/path' },
      requestId: expect.any(String),
    })
  })

  test('does not send unsafe web links to the app rpc', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    xtermMocks.webLinkAddons[0]!.open('javascript:alert(1)')
    xtermMocks.webLinkAddons[0]!.open('file:///tmp/secret')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/\u0000bad')
    await Promise.resolve()

    expect(invokeRpc).not.toHaveBeenCalled()
  })

  test('opens terminal when optional addon setup fails', async () => {
    Object.assign(xtermMocks.addonFailures, {
      search: true, serialize: true, unicode: true, webLinks: true,
      image: true, progress: true,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(terminalCalls.open).toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
    expect(session.findNext('needle')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    expect(session.serialize()).toBe('')
    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to load unicode11 addon', expect.any(Error))
    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to load web links addon', expect.any(Error))
    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to load search addon', expect.any(Error))
    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to load serialize addon', expect.any(Error))
    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to load image addon', expect.any(Error))
    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to load progress addon', expect.any(Error))
    expect(session.snapshot().progress).toBeUndefined()
    warnSpy.mockRestore()
  })

  test('uses first-class restart IPC instead of open forceNew', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledWith({
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
      terminalId: 'terminal-1',
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.open).toHaveBeenCalledTimes(1)
  })

  test('enters error state when terminal open fails', async () => {
    terminalCalls.open.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot()).toEqual({ phase: 'error', message: 'error.spawn-failed', processName: 'terminal' })
  })

  test('continues after terminal write failures', async () => {
    terminalCalls.write.mockRejectedValueOnce(new Error('write failed'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitData('input')
    await Promise.resolve()

    expect(terminalCalls.write).toHaveBeenCalledWith({ sessionId: 'session-1', data: 'input' })
    expect(session.snapshot().phase).toBe('open')
  })

  test('continues after terminal resize failures', async () => {
    terminalCalls.resize.mockRejectedValueOnce(new Error('resize failed'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDebounce()
    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDebounce()

    expect(terminalCalls.resize).toHaveBeenCalledTimes(2)
    expect(terminalCalls.resize).toHaveBeenNthCalledWith(1, { sessionId: 'session-1', cols: 101, rows: 31 })
    expect(terminalCalls.resize).toHaveBeenNthCalledWith(2, { sessionId: 'session-1', cols: 101, rows: 31 })
    expect(session.snapshot().phase).toBe('open')
  })

  test('forwards user input while replay is being written', async () => {
    terminalCalls.open.mockResolvedValueOnce(openResult('session-1', { replay: 'history', replaySeq: 1 }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'history'))

    xtermMocks.terminals[0]!.emitData('input during replay')
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(terminalCalls.write).toHaveBeenCalledWith({ sessionId: 'session-1', data: 'input during replay' })
  })

  test('resets the terminal before replaying truncated history', async () => {
    terminalCalls.open.mockResolvedValueOnce(openResult('session-1', { replay: 'tail', replayTruncated: true }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(xtermMocks.terminals[0]!.reset).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('tail')
  })

  test('batches terminal output writes on animation frames', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleOutput({ sessionId: 'other-session', data: 'ignored', seq: 1, processName: 'zsh' })
    session.handleOutput({ sessionId: 'session-1', data: 'first', seq: 1, processName: 'zsh' })
    session.handleOutput({ sessionId: 'session-1', data: 'second', seq: 2, processName: 'zsh' })

    expect(xtermMocks.terminals[0]!.write).not.toHaveBeenCalled()
    await flushTerminalStart()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('firstsecond')
  })

  test('flushes matching terminal exits before the provider dismisses the session', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleOutput({ sessionId: 'session-1', data: 'before exit', seq: 1, processName: 'zsh' })
    expect(session.handleExit({ sessionId: 'other-session' })).toBe(false)
    expect(session.handleExit({ sessionId: 'session-1' })).toBe(true)
    session.dispose()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('before exit')
    expect(session.snapshot()).toEqual({ phase: 'open', message: null, processName: 'zsh' })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('closes pending replacement session when disposed before restart reaches main', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    session.dispose()
    await flushTerminalStart()

    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(terminalCalls.close).toHaveBeenCalledWith({ sessionId: 'session-1' })
  })

  test('closes stale restart result when disposed while restart is in flight', async () => {
    const restart = deferred<TerminalOpenResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    session.dispose()
    restart.resolve(openResult('session-2'))
    await flushTerminalStart()

    expect(terminalCalls.close).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(terminalCalls.close).toHaveBeenCalledWith({ sessionId: 'session-2' })
  })

  test('disconnects ResizeObserver while parked and reinstalls on attach', async () => {
    const host = document.createElement('div')
    const parking = document.createElement('div')
    document.body.append(host, parking)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()
    const firstObserver = MockResizeObserver.instances[0]!

    session.detach(host, parking)
    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1)
    expect(parking.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()

    session.attach(host)
    expect(MockResizeObserver.instances).toHaveLength(2)
    expect(MockResizeObserver.instances[1]!.observe).toHaveBeenCalled()
  })

  test('focus checks are derived from the xterm DOM host', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()

    xtermMocks.terminals[0]!.focus()
    expect(isTerminalFocused()).toBe(true)
  })

  test('applies terminal theme and updates when the app theme changes', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())
    session.attach(host)
    await flushTerminalStart()

    const term = xtermMocks.terminals[0]!
    expect(term.options.theme).toMatchObject({ background: '#fbfbfd', foreground: '#1d1d1f' })
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.background).toBe(
      'rgb(251, 251, 253)',
    )
    expect(
      host
        .querySelector<HTMLElement>('.goblin-managed-terminal-frame')
        ?.style.getPropertyValue('--goblin-terminal-background'),
    ).toBe('#fbfbfd')

    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()

    expect(term.options.theme).toMatchObject({ background: '#111113', foreground: '#f5f5f7' })
    expect(
      host
        .querySelector<HTMLElement>('.goblin-managed-terminal-frame')
        ?.style.getPropertyValue('--goblin-terminal-background'),
    ).toBe('#111113')
  })

  test('loads image and progress addons', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(xtermMocks.imageAddons).toHaveLength(1)
    expect(xtermMocks.progressAddons).toHaveLength(1)
  })

  test('emits bell events for provider-level policy handling', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const onBell = vi.fn()
    const session = new ManagedTerminalSession(descriptor, notify, onBell)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitBell()
    expect(onBell).toHaveBeenCalledWith(descriptor, { processName: 'zsh', visible: true })
  })

  test('progress state appears in snapshot and clears on state 0', async () => {
    const notify = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, notify)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    xtermMocks.progressAddons[0]!.emitProgress(1, 75)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    expect(notify).toHaveBeenCalledTimes(1)

    xtermMocks.progressAddons[0]!.emitProgress(1, 100)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 100 })

    xtermMocks.progressAddons[0]!.emitProgress(0, 0)
    expect(session.snapshot().progress).toBeUndefined()
  })

  test('progress error and indeterminate states', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.progressAddons[0]!.emitProgress(2, 80)
    expect(session.snapshot().progress).toEqual({ state: 2, value: 80 })

    xtermMocks.progressAddons[0]!.emitProgress(3, 0)
    expect(session.snapshot().progress).toEqual({ state: 3, value: 0 })
  })

  test('progress state is cleared on restart', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.progressAddons[0]!.emitProgress(1, 75)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })

    session.restart()
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().progress).toBeUndefined()
  })

  test('progress value is clamped to 0-100', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSession(descriptor, vi.fn())

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.progressAddons[0]!.emitProgress(1, 150)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 100 })

    xtermMocks.progressAddons[0]!.emitProgress(1, -10)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 0 })
  })
})

function openResult(
  sessionId: string,
  overrides: Partial<Extract<TerminalOpenResult, { ok: true }>> = {},
): TerminalOpenResult {
  return {
    ok: true,
    sessionId,
    replay: '',
    replaySeq: 0,
    replayTruncated: false,
    processName: 'zsh',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function optionArrow(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, altKey: true, cancelable: true })
}

async function flushTerminalStart(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushResizeDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
  await Promise.resolve()
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition was not met')
}
