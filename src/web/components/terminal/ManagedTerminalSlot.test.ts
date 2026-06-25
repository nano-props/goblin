// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ILinkHandler } from '@xterm/xterm'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { ManagedTerminalSlot } from '#/web/components/terminal/ManagedTerminalSlot.ts'
import { terminalLog } from '#/web/logger.ts'
import { installTerminalThemeStyles } from '#/web/components/terminal/terminal-theme-test-utils.ts'
import { isTerminalFocused } from '#/web/terminal-focus.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type {
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSlotInput,
  TerminalTakeoverResult,
  TerminalTakeoverInput,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'

const xtermMocks = vi.hoisted(() => {
  const terminals: any[] = []
  const fitAddons: any[] = []
  const searchAddons: any[] = []
  const serializeAddons: any[] = []
  const unicodeAddons: any[] = []
  const webLinkAddons: any[] = []
  const imageAddons: any[] = []
  const progressAddons: any[] = []
  const deferredWriteCallbacks: Array<() => void> = []
  let deferWriteCallbacks = false
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
      allowProposedApi?: boolean
      cursorBlink?: boolean
      cursorStyle?: string
      fontFamily?: string
      fontSize?: number
      lineHeight?: number
      linkHandler?: ILinkHandler
      macOptionIsMeta?: boolean
      minimumContrastRatio?: number
      rescaleOverlappingGlyphs?: boolean
      theme?: { background?: string; foreground?: string }
      scrollOnUserInput?: boolean
    }
    element: HTMLDivElement | null = null
    modes = { applicationCursorKeysMode: false, bracketedPasteMode: false }
    refresh = vi.fn()
    write = vi.fn((_data: string, callback?: () => void) => {
      if (!callback) return
      if (deferWriteCallbacks) {
        deferredWriteCallbacks.push(callback)
        return
      }
      queueMicrotask(callback)
    })
    reset = vi.fn()
    scrollToBottom = vi.fn()
    dispose = vi.fn()
    focus = vi.fn(() => this.textarea?.focus())
    customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null
    private coreUserInputHandlers: Array<() => void> = []
    _core = {
      _charSizeService: { measure: vi.fn() },
      _renderService: { clear: vi.fn() },
      coreService: {
        onUserInput: vi.fn((cb: () => void) => {
          this.coreUserInputHandlers.push(cb)
          return {
            dispose: vi.fn(
              () => (this.coreUserInputHandlers = this.coreUserInputHandlers.filter((handler) => handler !== cb)),
            ),
          }
        }),
      },
    }
    private textarea: HTMLTextAreaElement | null = null
    private resizeHandlers: Array<(size: { cols: number; rows: number }) => void> = []
    private dataHandlers: Array<(data: string) => void> = []
    private binaryHandlers: Array<(data: string) => void> = []
    private keyHandlers: Array<(event: { key: string; domEvent: KeyboardEvent }) => void> = []
    private bellHandlers: Array<() => void> = []
    private titleHandlers: Array<(title: string) => void> = []

    constructor(options: {
      allowProposedApi?: boolean
      cols: number
      rows: number
      cursorBlink?: boolean
      cursorStyle?: string
      fontFamily?: string
      fontSize?: number
      lineHeight?: number
      linkHandler?: ILinkHandler
      macOptionIsMeta?: boolean
      minimumContrastRatio?: number
      rescaleOverlappingGlyphs?: boolean
      theme?: { background?: string; foreground?: string }
      scrollOnUserInput?: boolean
    }) {
      this.cols = options.cols
      this.rows = options.rows
      this.options = {
        allowProposedApi: options.allowProposedApi,
        cursorBlink: options.cursorBlink,
        cursorStyle: options.cursorStyle,
        fontFamily: options.fontFamily,
        fontSize: options.fontSize,
        lineHeight: options.lineHeight,
        linkHandler: options.linkHandler,
        macOptionIsMeta: options.macOptionIsMeta,
        minimumContrastRatio: options.minimumContrastRatio,
        rescaleOverlappingGlyphs: options.rescaleOverlappingGlyphs,
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

    onKey(cb: (event: { key: string; domEvent: KeyboardEvent }) => void) {
      this.keyHandlers.push(cb)
      return { dispose: vi.fn(() => (this.keyHandlers = this.keyHandlers.filter((handler) => handler !== cb))) }
    }

    onResize(cb: (size: { cols: number; rows: number }) => void) {
      this.resizeHandlers.push(cb)
      return { dispose: vi.fn(() => (this.resizeHandlers = this.resizeHandlers.filter((handler) => handler !== cb))) }
    }

    onBell(cb: () => void) {
      this.bellHandlers.push(cb)
      return { dispose: vi.fn(() => (this.bellHandlers = this.bellHandlers.filter((handler) => handler !== cb))) }
    }

    onTitleChange(cb: (title: string) => void) {
      this.titleHandlers.push(cb)
      return { dispose: vi.fn(() => (this.titleHandlers = this.titleHandlers.filter((handler) => handler !== cb))) }
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

    emitUserData(data: string) {
      const domEvent = new KeyboardEvent('keydown')
      for (const handler of this.coreUserInputHandlers) handler()
      for (const handler of this.keyHandlers) handler({ key: data, domEvent })
      this.emitData(data)
    }

    emitCoreUserData(data: string) {
      for (const handler of this.coreUserInputHandlers) handler()
      this.emitData(data)
    }

    emitBinary(data: string) {
      for (const handler of this.binaryHandlers) handler(data)
    }

    emitBell() {
      for (const handler of this.bellHandlers) handler()
    }

    emitTitleChange(title: string) {
      for (const handler of this.titleHandlers) handler(title)
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

    readonly options?: { highlightLimit?: number }
    constructor(options?: { highlightLimit?: number }) {
      this.options = options
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

    readonly handler?: (event: MouseEvent, uri: string) => void
    constructor(handler?: (event: MouseEvent, uri: string) => void) {
      this.handler = handler
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
    deferWriteCallbacks(value: boolean) {
      deferWriteCallbacks = value
    },
    flushDeferredWriteCallbacks() {
      for (const callback of deferredWriteCallbacks.splice(0)) callback()
    },
    flushNextDeferredWriteCallback() {
      deferredWriteCallbacks.shift()?.()
    },
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

// jsdom does not lay out, so proposeTerminalGeometry would return null. The
// orchestrator now waits for a measurable host via waitForMeasurableHost;
// mock the geometry module so the synchronous happy path resolves.
const geometryMocks = vi.hoisted(() => ({
  preloadTerminalFont: vi.fn(async () => {}),
  proposeTerminalGeometry: vi.fn<() => { cols: number; rows: number } | null>(() => ({ cols: 80, rows: 24 })),
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  preloadTerminalFont: geometryMocks.preloadTerminalFont,
  proposeTerminalGeometry: geometryMocks.proposeTerminalGeometry,
  TERMINAL_FONT_FAMILY: "'Goblin Mono', monospace",
  TERMINAL_FONT_SIZE: 14,
  TERMINAL_LINE_HEIGHT: 1,
  DEFAULT_TERMINAL_COLS: 80,
  DEFAULT_TERMINAL_ROWS: 24,
}))

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  observe = vi.fn()
  disconnect = vi.fn()

  readonly cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
    MockResizeObserver.instances.push(this)
  }
}

class MockFontFaceSet {
  private readonly loadingDoneHandlers = new Set<() => void>()
  private readonly handlerMap = new Map<EventListenerOrEventListenerObject, () => void>()
  private readyDeferred = deferred<void>()
  ready = this.readyDeferred.promise

  check(): boolean {
    return false
  }

  load(): Promise<FontFace[]> {
    return Promise.resolve([])
  }

  reset(): void {
    this.loadingDoneHandlers.clear()
    this.handlerMap.clear()
    this.readyDeferred = deferred<void>()
    this.ready = this.readyDeferred.promise
  }

  addEventListener(event: string, listener: EventListenerOrEventListenerObject): void {
    if (event !== 'loadingdone') return
    const handler =
      typeof listener === 'function'
        ? () => listener(new Event('loadingdone'))
        : () => listener.handleEvent(new Event('loadingdone'))
    this.handlerMap.set(listener, handler)
    this.loadingDoneHandlers.add(handler)
  }

  removeEventListener(event: string, listener: EventListenerOrEventListenerObject): void {
    if (event !== 'loadingdone') return
    const handler = this.handlerMap.get(listener)
    if (!handler) return
    this.handlerMap.delete(listener)
    this.loadingDoneHandlers.delete(handler)
  }

  resolveReady(): void {
    this.readyDeferred.resolve()
  }

  emitLoadingDone(): void {
    for (const handler of this.loadingDoneHandlers) handler()
  }
}

const terminalCalls = {
  attach: vi.fn<(input: TerminalAttachInput) => Promise<TerminalAttachResult>>(),
  restart: vi.fn<(input: TerminalRestartInput) => Promise<TerminalAttachResult>>(),
  write: vi.fn<(input: TerminalWriteInput) => Promise<TerminalMutationResult>>(),
  resize: vi.fn<(input: TerminalResizeInput) => Promise<TerminalMutationResult>>(),
  takeover: vi.fn<(input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>>(),
  close: vi.fn<(input: TerminalSlotInput) => Promise<TerminalMutationResult>>(),
  notifyBell: vi.fn<(input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>>(),
  setBadge: vi.fn<(count: number) => void>(),
}
const invokeIpc = vi.fn<Window['goblinNative']['invokeIpc']>()
const shellOpenExternalUrl = vi.fn<NonNullable<Window['goblinNative']['shell']>['openExternalUrl']>()
const mockFonts = new MockFontFaceSet()

const descriptor = {
  key: '/repo\0/worktree',
  worktreeTerminalKey: '/repo\0/worktree',
  slotId: 'slot-1',
  index: 1,
  repoRoot: '/repo',
  branch: 'feature',
  worktreePath: '/worktree',
}

beforeEach(() => {
  // Use fake timers so font refit waits and the rAF chain fire deterministically when helpers advance the clock, instead of
  // burning real wall time on every test.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
  })
  xtermMocks.terminals.length = 0
  xtermMocks.fitAddons.length = 0
  xtermMocks.searchAddons.length = 0
  xtermMocks.serializeAddons.length = 0
  xtermMocks.unicodeAddons.length = 0
  xtermMocks.webLinkAddons.length = 0
  xtermMocks.imageAddons.length = 0
  xtermMocks.progressAddons.length = 0
  xtermMocks.deferWriteCallbacks(false)
  xtermMocks.flushDeferredWriteCallbacks()
  Object.assign(xtermMocks.addonFailures, {
    search: false,
    serialize: false,
    unicode: false,
    webLinks: false,
    image: false,
    progress: false,
  })
  MockResizeObserver.instances.length = 0
  vi.clearAllMocks()
  installTerminalThemeStyles()
  document.documentElement.setAttribute('data-theme', 'light')
  mockFonts.reset()
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver })
  Object.defineProperty(document, 'fonts', { configurable: true, value: mockFonts })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0),
  })
  // The rAF mock hands out setTimeout handles, so cancelAnimationFrame must
  // clear them via clearTimeout. The real cancelAnimationFrame in jsdom would
  // fail to recognize a setTimeout handle; routing through clearTimeout keeps
  // the session's `cancelScheduledAnimationFrame` working under fake timers.
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (handle: number) => window.clearTimeout(handle),
  })
  window.sessionStorage.setItem('goblin:web-terminal-client-id', 'client_local')
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
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      invokeIpc: invokeIpc.mockResolvedValue({ ok: true }),
      abortIpc: vi.fn(),
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      pathForFile: vi.fn(),
      onEvent: vi.fn(),
      shell: {
        openSettingsWindow: vi.fn(),
        openExternalUrl: shellOpenExternalUrl.mockResolvedValue({ ok: true, message: 'https://example.com/path' }),
        openDirectoryDialog: vi.fn(),
        consumeExternalOpenPaths: vi.fn(),
        openInFinder: vi.fn(),
      },
      terminal: {
        attach: terminalCalls.attach.mockResolvedValue(attachResult('pty_session_1_aaaaaaaaa')),
        restart: terminalCalls.restart.mockResolvedValue(attachResult('pty_session_2_aaaaaaaaa')),
        write: terminalCalls.write.mockResolvedValue(true),
        resize: terminalCalls.resize.mockResolvedValue(true),
        takeover: terminalCalls.takeover.mockResolvedValue(takeoverResult('pty_session_1_aaaaaaaaa')),
        close: terminalCalls.close.mockResolvedValue(true),
        notifyBell: terminalCalls.notifyBell.mockResolvedValue(true),
        create: vi.fn(),
        pruneTerminals: vi.fn(),
        onOutput: vi.fn(),
        onTitle: vi.fn(),
        onExit: vi.fn(),
        onIdentity: vi.fn(),
        onLifecycle: vi.fn(),
        onSessionsChanged: vi.fn(),
        onSlotClosed: vi.fn(),
      },
    },
  })
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: (capability) =>
      capability === 'settings-ipc' ||
      capability === 'open-settings-window' ||
      capability === 'open-external-url' ||
      capability === 'open-directory-dialog' ||
      capability === 'consume-external-open-paths' ||
      capability === 'open-in-finder' ||
      capability === 'terminal-notifications' ||
      capability === 'terminal-badge',
    getBootstrap: () => ({
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
    }),
    invokeIpc,
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    saveClipboardFiles: vi.fn(() => Promise.resolve([])),
    shell: () => window.goblinNative.shell ?? null,
    terminal: () => ({
      attach: terminalCalls.attach.mockResolvedValue(attachResult('pty_session_1_aaaaaaaaa')),
      restart: terminalCalls.restart.mockResolvedValue(attachResult('pty_session_2_aaaaaaaaa')),
      write: terminalCalls.write.mockResolvedValue(true),
      resize: terminalCalls.resize.mockResolvedValue(true),
      takeover: terminalCalls.takeover.mockResolvedValue(takeoverResult('pty_session_1_aaaaaaaaa')),
      close: terminalCalls.close.mockResolvedValue(true),
      create: vi.fn(async (input?: { kind?: string }) =>
        input?.kind === 'primary'
          ? {
              action: 'reused' as const,
              key: 'repo\0worktree\0slot-1',
              sessions: [],
              ...createFirstFrame('slot-1'),
              ok: true as const,
            }
          : {
              action: 'created' as const,
              key: 'repo\0worktree\0slot-2',
              sessions: [],
              ...createFirstFrame('slot-2'),
              ok: true as const,
            },
      ),
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      listSessions: vi.fn(async () => []),
      prewarm: vi.fn(async () => {}),
      kickReconnect: vi.fn(() => {}),
      getSlotSnapshot: vi.fn(async () => null),
      notifyBell: terminalCalls.notifyBell.mockResolvedValue(true),
      sendTestNotification: vi.fn(async () => true),
      setBadge: terminalCalls.setBadge,
      onOutput: vi.fn(() => () => {}),
      onTitle: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
      onIdentity: vi.fn(() => () => {}),
      onLifecycle: vi.fn(() => () => {}),
      onSessionsChanged: vi.fn(() => () => {}),
      onSlotClosed: vi.fn(() => () => {}),
    }),
  })
})

describe('ManagedTerminalSlot', () => {
  test('opens xterm and attaches the primary terminal session with fitted dimensions', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals[0]!.options.minimumContrastRatio).toBe(4.5)
    expect(xtermMocks.terminals[0]!.options.allowProposedApi).toBe(true)
    expect(xtermMocks.terminals[0]!.options.cursorStyle).toBe('bar')
    expect(xtermMocks.terminals[0]!.options.fontFamily).toContain('Goblin Mono')
    expect(xtermMocks.terminals[0]!.options.rescaleOverlappingGlyphs).toBe(true)
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
  })

  test('dispose during font preload aborts before waitForMeasurableHost runs', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    // Park preloadTerminalFont so the orchestrator yields mid-openPhase.
    let resolvePreload!: () => void
    geometryMocks.preloadTerminalFont.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolvePreload = r
        }),
    )

    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    // Session is parked inside the await preloadTerminalFont() call —
    // no ResizeObserver should exist yet because the geometry wait has
    // not been reached.
    expect(MockResizeObserver.instances).toHaveLength(0)

    // Dispose while the preload promise is unresolved. Then resolve it.
    session.dispose()
    resolvePreload()
    await flushTerminalStart()

    // The guard after the preload await must catch the disposed state and
    // throw StartCancelledError before reaching waitForMeasurableHost, so
    // no ResizeObserver should have been created against a detached host.
    expect(MockResizeObserver.instances).toHaveLength(0)
    expect(xtermMocks.terminals).toHaveLength(0)
  })

  test('remeasures and refits after fonts finish loading', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    const fitAddon = xtermMocks.fitAddons[0]!
    term.refresh.mockClear()
    fitAddon.fit.mockClear()

    mockFonts.resolveReady()
    await flushFontRefit()

    expect(fitAddon.fit).toHaveBeenCalledTimes(1)
    expect(term.refresh).not.toHaveBeenCalled()

    term.refresh.mockClear()
    fitAddon.fit.mockClear()

    mockFonts.emitLoadingDone()
    await flushFontRefit()

    expect(fitAddon.fit).toHaveBeenCalledTimes(1)
    expect(term.refresh).not.toHaveBeenCalled()
  })

  test('loads terminal addons and exposes search and serialization', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

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
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)

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
      await flushTerminalStart()

      // Rapid option-arrow keys are batched into a single write via queueMicrotask.
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: '\x1bb\x1bf\x1b[A\x1b[B' })

      term.modes.applicationCursorKeysMode = true
      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(true)
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value: savedPlatform })
    }
  })

  test('works around Safari Shift+symbol key bug by sending correct char directly', async () => {
    const savedUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    })
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const term = xtermMocks.terminals[0]!
      expect(term.customKeyEventHandler).toBeTypeOf('function')

      // Safari reports unshifted '/' for Shift+Slash — workaround should send '?'.
      const slashEvent = new KeyboardEvent('keydown', { key: '/', code: 'Slash', shiftKey: true, cancelable: true })
      expect(term.customKeyEventHandler?.(slashEvent)).toBe(false)

      // Safari reports empty key for Shift+Digit1 — workaround should send '!'.
      const digit1Event = new KeyboardEvent('keydown', { key: '', code: 'Digit1', shiftKey: true, cancelable: true })
      expect(term.customKeyEventHandler?.(digit1Event)).toBe(false)

      await flushTerminalStart()

      // Rapid Safari shift keys are batched into a single write via queueMicrotask.
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: '?!' })
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: savedUserAgent })
    }
  })

  test('reuses remembered Safari layout for empty Shift+symbol events on multi-layout keys', async () => {
    const savedUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    })
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const term = xtermMocks.terminals[0]!
      expect(term.customKeyEventHandler).toBeTypeOf('function')

      const learnLayoutEvent = new KeyboardEvent('keydown', {
        key: '；',
        code: 'Semicolon',
        shiftKey: false,
        cancelable: true,
      })
      expect(term.customKeyEventHandler?.(learnLayoutEvent)).toBe(true)

      const brokenShiftEvent = new KeyboardEvent('keydown', {
        key: '',
        code: 'Semicolon',
        shiftKey: true,
        cancelable: true,
      })
      expect(term.customKeyEventHandler?.(brokenShiftEvent)).toBe(false)

      await flushTerminalStart()

      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: '：' })
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: savedUserAgent })
    }
  })

  test('does not intercept Shift+symbol on Chrome', async () => {
    const savedUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    })
    try {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const term = xtermMocks.terminals[0]!
      const slashEvent = new KeyboardEvent('keydown', { key: '/', code: 'Slash', shiftKey: true, cancelable: true })
      // Chrome is not Safari, so the workaround should not intercept — let xterm.js handle it.
      expect(term.customKeyEventHandler?.(slashEvent)).toBe(true)
      expect(terminalCalls.write).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: savedUserAgent })
    }
  })

  test('opens web links through the safe shell bridge', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/path')
    await Promise.resolve()

    expect(shellOpenExternalUrl).toHaveBeenCalledWith({ url: 'https://example.com/path', allowHttp: true })
  })

  test('opens OSC 8 hyperlinks through the safe shell bridge', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    const event = new MouseEvent('click', { cancelable: true })
    xtermMocks.terminals[0]!.options.linkHandler!.activate(event, 'https://example.com/osc8', {
      start: { x: 1, y: 1 },
      end: { x: 10, y: 1 },
    })
    await Promise.resolve()

    expect(event.defaultPrevented).toBe(true)
    expect(xtermMocks.terminals[0]!.options.linkHandler!.allowNonHttpProtocols).toBe(false)
    expect(shellOpenExternalUrl).toHaveBeenCalledWith({ url: 'https://example.com/osc8', allowHttp: true })
  })

  test('does not send unsafe web links to the app ipc', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    xtermMocks.webLinkAddons[0]!.open('javascript:alert(1)')
    xtermMocks.webLinkAddons[0]!.open('file:///tmp/secret')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/\u0000bad')
    await Promise.resolve()

    expect(shellOpenExternalUrl).not.toHaveBeenCalled()
  })

  test('opens terminal when optional addon setup fails', async () => {
    Object.assign(xtermMocks.addonFailures, {
      search: true,
      serialize: true,
      unicode: true,
      webLinks: true,
      image: true,
      progress: true,
    })
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(terminalCalls.attach).toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
    expect(session.findNext('needle')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    expect(session.serialize()).toBe('')
    expect(warnSpy).toHaveBeenCalledWith('failed to load unicode11 addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load web links addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load search addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load serialize addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load image addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load progress addon', { err: expect.any(Error) })
    expect(session.snapshot().progress).toBeUndefined()
    warnSpy.mockRestore()
  })

  test('uses first-class restart IPC instead of recreating through ensureSlot forceNew', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
  })

  test('enters error state when terminal attach fails', async () => {
    terminalCalls.attach.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot()).toEqual({
      phase: 'error',
      message: 'error.spawn-failed',
      processName: 'zsh',
      canonicalTitle: null,
    })
  })

  test('continues after terminal write failures', async () => {
    terminalCalls.write.mockRejectedValueOnce(new Error('write failed'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitData('input')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'input' })
    expect(session.snapshot().phase).toBe('open')
  })

  test('batches rapid user input into a single ordered write', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.emitData('c')
    term.emitData('l')
    term.emitData('e')
    term.emitData('a')
    term.emitData('r')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'clear' })
  })

  test('drops buffered input after dispose', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitData('x')
    session.dispose()

    await flushTerminalStart()

    // The pending write buffer is cleared on dispose; nothing is sent.
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('continues after terminal resize failures', async () => {
    terminalCalls.resize.mockRejectedValueOnce(new Error('resize failed'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDispatch()
    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDispatch()

    expect(terminalCalls.resize).toHaveBeenCalledTimes(2)
    expect(terminalCalls.resize).toHaveBeenNthCalledWith(1, { ptySessionId: 'pty_session_1_aaaaaaaaa', cols: 101, rows: 31 })
    expect(terminalCalls.resize).toHaveBeenNthCalledWith(2, { ptySessionId: 'pty_session_1_aaaaaaaaa', cols: 101, rows: 31 })
    expect(session.snapshot().phase).toBe('open')
  })

  test('resize is gated by AuthorityGate — denied gate never calls bridge.resize', async () => {
    // Attach as a viewer: the gate's role lands on `viewer` so a
    // subsequent gate denial can be forced by returning a
    // 'slot-closed' result from the takeover. We patch the gate
    // after attach so we don't fight the auto-claim.
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    // Force the gate to deny with `slot-closed` on the next
    // `authorize` call. The accessor lazy-builds the gate, so we
    // have to reach into the slot's private field.
    const gate = (session as unknown as { authorityGate?: { setRole: (r: 'viewer' | 'unowned') => void } })
      .authorityGate
    expect(gate).toBeDefined()
    gate!.setRole('unowned')

    terminalCalls.resize.mockClear()
    xtermMocks.terminals[0]!.resize(120, 40)
    await flushResizeDispatch()
    // Give the gate's authorize promise one more microtask to settle.
    await Promise.resolve()
    await Promise.resolve()
    expect(terminalCalls.resize).not.toHaveBeenCalled()
  })

  test('does not send resize or input while attached as a mirror page before explicit takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDispatch()
    expect(terminalCalls.resize).not.toHaveBeenCalled()

    xtermMocks.terminals[0]!.emitData('input')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
    expect(terminalCalls.resize).not.toHaveBeenCalled()
    expect(session.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      canTakeover: true,
    })
  })

  test('preloads hydrated snapshot before attaching as controller', async () => {
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.hydrate({
      ptySessionId: 'session-remote',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
      snapshot: 'hydrated-screen',
      snapshotSeq: 5,
    })
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    expect(term.reset).toHaveBeenCalled()
    expect(term.write).toHaveBeenNthCalledWith(1, 'hydrated-screen', expect.any(Function))
    expect(terminalCalls.attach).toHaveBeenCalled()
  })

  test('clears hydratedSnapshot after preloadHydratedSnapshot writes the snapshot to the term', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.hydrate({
      ptySessionId: 'session-remote',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
      snapshot: 'hydrated-screen',
      snapshotSeq: 5,
    })
    // Sanity-check the leak precondition: hydrate() populated the field.
    expect(
      (session as unknown as { hydratedSnapshot: { snapshot: string; snapshotSeq: number } }).hydratedSnapshot,
    ).toEqual({ snapshot: 'hydrated-screen', snapshotSeq: 5 })

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    // The T1.5 fix: after the write resolves, the field should be reset
    // to the empty sentinel so we don't keep a stale up-to-16 MiB copy
    // around until the next hydrate().
    expect(hydratedSnapshot(session)).toEqual({ snapshot: '', snapshotSeq: 0 })
  })

  test('clears hydratedSnapshot after applyHydratedSnapshotToActiveView writes the snapshot to the term', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.reset.mockClear()
    term.write.mockClear()

    // hydrate() with a different ptySessionId triggers
    // applyHydratedSnapshotToActiveView on the existing term (line 204).
    session.hydrate({
      ptySessionId: 'pty_session_2_aaaaaaaaa',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
      snapshot: 'rehydrated',
      snapshotSeq: 7,
    })

    expect(term.write).toHaveBeenCalledWith('rehydrated', expect.any(Function))

    // The T1.5 fix: after the term.write callback fires, the field is
    // cleared. The mock invokes the callback via queueMicrotask, so
    // draining microtasks is enough to observe the post-callback state.
    await flushResizeDispatch()
    expect(hydratedSnapshot(session)).toEqual({ snapshot: '', snapshotSeq: 0 })
  })

  test('resets an existing terminal view when hydrate switches to a different session id', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.reset.mockClear()
    term.write.mockClear()

    session.hydrate({
      ptySessionId: 'session-remote',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
      snapshot: 'remote-screen',
      snapshotSeq: 5,
    })
    await flushTerminalStart()

    expect(term.reset).toHaveBeenCalled()
    // T1.5: applyHydratedSnapshotToActiveView now passes a callback as the
    // second arg so it can clear the field after the write resolves.
    expect(term.write).toHaveBeenCalledWith('remote-screen', expect.any(Function))
    expect(session.currentPtySessionId()).toBe('session-remote')
  })

  test('does not rewrite an existing terminal view when hydrate refreshes the same session snapshot', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.reset.mockClear()
    term.write.mockClear()

    session.hydrate({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
      snapshot: 'fresher-same-session-screen',
      snapshotSeq: 99,
    })
    await flushTerminalStart()

    expect(term.reset).not.toHaveBeenCalled()
    expect(term.write).not.toHaveBeenCalled()
    expect(session.currentPtySessionId()).toBe('pty_session_1_aaaaaaaaa')
  })

  test('stale active hydrate replay callback does not close a newer replay boundary', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.reset.mockClear()
    term.write.mockClear()
    terminalCalls.write.mockClear()
    xtermMocks.deferWriteCallbacks(true)

    session.hydrate({
      ptySessionId: 'pty_session_2_aaaaaaaaa',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
      snapshot: 'older-replay',
      snapshotSeq: 10,
    })
    session.hydrate({
      ptySessionId: 'pty_session_3_aaaaaaaaa',
      phase: 'open',
      message: null,
      processName: 'node',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
      snapshot: 'newer-replay',
      snapshotSeq: 11,
    })

    xtermMocks.flushNextDeferredWriteCallback()
    term.emitData('\x1b]10;rgb:1d1d/1d1d/1f1f\x1b\\')
    await flushTerminalStart()
    await flushResizeDispatch()

    expect(terminalCalls.write).not.toHaveBeenCalled()

    xtermMocks.flushNextDeferredWriteCallback()
    xtermMocks.deferWriteCallbacks(false)
  })

  test('does not notify on ordinary input while already attached', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new ManagedTerminalSlot(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    xtermMocks.terminals[0]!.emitData('hello')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'hello' })
    expect(notify).not.toHaveBeenCalled()
  })

  test('tracks server title changes separately from process name', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new ManagedTerminalSlot(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    session.handleServerTitle('~/Developer/goblin — npm run dev')

    expect(session.snapshot()).toMatchObject({
      phase: 'open',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('ignores input while attached as a mirror until takeover occurs', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new ManagedTerminalSlot(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    xtermMocks.terminals[0]!.emitData('blocked')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
    expect(session.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      canTakeover: true,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  test('takeover response is the authoritative handshake (no realtime event required)', async () => {
    // After the takeover atomicity follow-up, the `terminal.takeover`
    // response carries role/controllerStatus/canonicalCols/Rows/phase
    // and is applied synchronously. The client does NOT have to
    // wait for a realtime `identity` event before painting the
    // post-takeover frame. A subsequent realtime event for the same
    // session is idempotent.
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 101,
        canonicalRows: 31,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDispatch()
    expect(session.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      canTakeover: true,
    })

    session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length > 0)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 101,
      rows: 31,
      clientId: 'client_local',
    })
    // The takeover response itself is now the authority — without
    // any `handleIdentity` call, role already flipped to controller
    // and the canonical size tracks the request (101x31).
    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canTakeover: false,
      canonicalCols: 101,
      canonicalRows: 31,
    })

    // A later realtime identity event for the same session is a
    // benign re-apply — the runtime treats it as idempotent because
    // every field already matches.
    session.handleIdentity({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 101,
      canonicalRows: 31,

    })

    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canTakeover: false,
    })
  })

  test('takeover response starts a controller view for a hydrated viewer without a realtime event', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 80,
        canonicalRows: 24,
      }),
    )
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 80,
        canonicalRows: 24,
        snapshot: 'post-takeover-screen',
        snapshotSeq: 8,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session, {
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    session.attach(host)

    expect(xtermMocks.terminals).toHaveLength(0)

    await expect(session.takeover()).resolves.toBe(true)
    await flushTerminalStart()

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 80,
      rows: 24,
      clientId: 'client_local',
    })
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals).toHaveLength(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('post-takeover-screen', expect.any(Function))
    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    })
  })

  test('mounting a hydrated unowned session attaches and auto-claims without manual takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session, {
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 120,
      canonicalRows: 40,
    })

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals).toHaveLength(1)
    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canTakeover: false,
    })
  })

  test('mounted viewer hydrate to unowned auto-attaches without manual takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
        snapshot: 'reclaimed-after-hydrate',
        snapshotSeq: 10,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session, {
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.hydrate({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 120,
      canonicalRows: 40,
      snapshot: '',
      snapshotSeq: 0,
    })
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(1, {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canTakeover: false,
    })
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('reclaimed-after-hydrate', expect.any(Function))
  })

  test('takeover falls back to canonical size when the host is not immediately measurable', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    geometryMocks.proposeTerminalGeometry.mockReturnValueOnce(null)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session, {
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    session.attach(host)

    await expect(session.takeover()).resolves.toBe(true)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 120,
      rows: 40,
      clientId: 'client_local',
    })
  })

  test('takeover response propagates geometry into the runtime view', async () => {
    // The response carries canonicalCols/Rows alongside role — the
    // runtime applies all three in one shot. This is the new atomic-
    // handshake contract: a viewer who clicks takeover sees the
    // post-takeover geometry immediately, not after a follow-up
    // realtime identity event.
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalCols: 132,
        canonicalRows: 43,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length > 0)

    expect(session.snapshot().attachment).toMatchObject({
      canonicalCols: 132,
      canonicalRows: 43,
      role: 'controller',
    })
  })

  test('takeover response propagates phase into the runtime view', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        phase: 'restarting',
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length > 0)

    expect(session.snapshot().phase).toBe('restarting')
  })

  test('realtime identity event is the authority for non-takeover paths', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: null,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length > 0)

    session.handleIdentity({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 120,
      canonicalRows: 40,

    })

    expect(session.snapshot().attachment).toMatchObject({
      role: 'unowned',
      controllerStatus: 'none',
      canTakeover: true,
      canonicalCols: 120,
      canonicalRows: 40,
    })
  })

  test('mounted viewer auto-attaches when realtime identity flips to unowned', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalCols: 120,
          canonicalRows: 40,
        }),
      )
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalCols: 100,
          canonicalRows: 30,
          snapshot: 'reclaimed-screen',
          snapshotSeq: 9,
        }),
      )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().attachment).toMatchObject({
      role: 'viewer',
      controllerStatus: 'connected',
      canTakeover: true,
    })

    session.handleIdentity({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 120,
      canonicalRows: 40,

    })
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canTakeover: false,
    })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('reclaimed-screen', expect.any(Function))

    // Bug 1+2 regression: after the controller→unowned→recreate
    // cycle, the gate's role cache must reflect the runtime's
    // current role. Otherwise the next write would spuriously
    // trigger a takeover round-trip to a server that already
    // considers us the controller. The runtime is now 'controller'
    // (asserted above); the gate must agree.
    const gate = (session as unknown as { authorityGate?: { currentRole(): 'controller' | 'viewer' | 'unowned' } })
      .authorityGate
    expect(gate).toBeDefined()
    expect(gate!.currentRole()).toBe('controller')
  })

  test('applies identity updates from realtime messages', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleIdentity({
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 101,
      canonicalRows: 31,

    })

    expect(session.snapshot().attachment).toMatchObject({
      role: 'controller',
      controllerStatus: 'connected',
      canTakeover: false,
      canonicalCols: 101,
      canonicalRows: 31,
    })
  })

  test('drops terminal-emulator input while replay is being written', async () => {
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'history', snapshotSeq: 1 }))
    xtermMocks.deferWriteCallbacks(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'history'))

    xtermMocks.terminals[0]!.emitData('\x1b]10;rgb:1d1d/1d1d/1f1f\x1b\\')
    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => session.snapshot().phase === 'open')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('forwards xterm core-attributed user input while replay is being written', async () => {
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'history', snapshotSeq: 1 }))
    xtermMocks.deferWriteCallbacks(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'history'))

    xtermMocks.terminals[0]!.emitCoreUserData('input during replay')
    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => session.snapshot().phase === 'open')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'input during replay' })
  })

  test('forwards xterm binary mouse input while replay is being written', async () => {
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'history', snapshotSeq: 1 }))
    xtermMocks.deferWriteCallbacks(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'history'))

    xtermMocks.terminals[0]!.emitBinary('\x1b[M ##')
    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => session.snapshot().phase === 'open')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: '\x1b[M ##' })
  })

  test('resets the terminal before replaying the snapshot', async () => {
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'tail', snapshotSeq: 1 }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'tail'))

    expect(xtermMocks.terminals[0]!.reset).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('tail', expect.any(Function))
  })

  test('batches terminal output writes on animation frames', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new ManagedTerminalSlot(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    session.handleOutput({ ptySessionId: 'other-session', data: 'ignored', seq: 1, processName: 'zsh' })
    session.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'first', seq: 1, processName: 'zsh' })
    session.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'second', seq: 2, processName: 'zsh' })

    // Controller mode: metadata doesn't change (processName was already set during attach)
    expect(notify).toHaveBeenCalledTimes(0)
    expect(xtermMocks.terminals[0]!.write).not.toHaveBeenCalled()
    await flushTerminalStart()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('firstsecond')
  })

  test('flushes matching terminal exits before the provider dismisses the session', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleOutput({ ptySessionId: 'pty_session_1_aaaaaaaaa', data: 'before exit', seq: 1, processName: 'zsh' })
    expect(session.handleExit({ ptySessionId: 'other-session' })).toBe(false)
    expect(session.handleExit({ ptySessionId: 'pty_session_1_aaaaaaaaa' })).toBe(true)
    session.dispose()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('before exit')
    expect(session.snapshot()).toEqual({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('keeps attach result title when selecting a mirrored session', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        canonicalTitle: '~/Developer/goblin — npm run dev',
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session, {
      ptySessionId: 'pty_session_1_aaaaaaaaa',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      role: 'viewer',
      controllerStatus: 'connected',
    })

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot()).toMatchObject({
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
  })

  test('closes pending replacement session when disposed before restart reaches main', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    // The new `requestDurableClose` callback is the seam ManagedTerminalSlot
    // uses to hand a close off to the registry's durable queue. In production
    // the queue dedupes and the registry awaits it on the next create; in
    // this test we wire it straight to `terminalCalls.close` so the same
    // assertions the old test made still hold.
    const pendingCloses: Array<Promise<unknown>> = []
    const session = new ManagedTerminalSlot(descriptor, vi.fn(), null, async (ptySessionId) => {
      const promise = terminalCalls.close({ ptySessionId })
      pendingCloses.push(promise)
      await promise
    })
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    session.dispose()
    await flushTerminalStart()
    // The close is now routed through the durable callback, not the
    // bridge directly. Awaiting the queue's pending promise is the
    // equivalent of "the registry's queue settled".
    await Promise.allSettled(pendingCloses)

    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(terminalCalls.close).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa' })
  })

  test('closes stale restart result when disposed while restart is in flight', async () => {
    const restart = deferred<TerminalAttachResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    // See the comment in the previous test for why we wire
    // `requestDurableClose` to `terminalCalls.close` here.
    const pendingCloses: Array<Promise<unknown>> = []
    const session = new ManagedTerminalSlot(descriptor, vi.fn(), null, async (ptySessionId) => {
      const promise = terminalCalls.close({ ptySessionId })
      pendingCloses.push(promise)
      await promise
    })
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    session.dispose()
    restart.resolve(attachResult('pty_session_2_aaaaaaaaa'))
    await flushTerminalStart()
    await Promise.allSettled(pendingCloses)

    expect(terminalCalls.close).toHaveBeenCalledWith({ ptySessionId: 'pty_session_1_aaaaaaaaa' })
    expect(terminalCalls.close).toHaveBeenCalledWith({ ptySessionId: 'pty_session_2_aaaaaaaaa' })
  })

  test('disconnects ResizeObserver while parked and reinstalls on attach', async () => {
    const host = document.createElement('div')
    const parking = document.createElement('div')
    document.body.append(host, parking)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
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
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    xtermMocks.terminals[0]!.focus()
    expect(isTerminalFocused()).toBe(true)
  })

  test('applies terminal theme and updates when the app theme changes', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)
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
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

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
    const session = new ManagedTerminalSlot(descriptor, notify, onBell)
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitBell()
    expect(onBell).toHaveBeenCalledWith(descriptor, { processName: 'zsh', canonicalTitle: null, visible: true })
  })

  test('progress state appears in snapshot and clears on state 0', async () => {
    const notify = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new ManagedTerminalSlot(descriptor, notify)
    hydrateManagedSession(session)

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
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

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
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

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
    const session = new ManagedTerminalSlot(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.progressAddons[0]!.emitProgress(1, 150)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 100 })

    xtermMocks.progressAddons[0]!.emitProgress(1, -10)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 0 })
  })

  // Contract: identity (response + realtime event interleavings).
  // The takeover atomicity work made the response authoritative AND
  // kept the realtime event firing for other listeners. This test
  // pins the one orthogonal new invariant that the existing
  // follow-up #2 tests don't already cover: that phase is part of
  // the realtime event surface and can override the response's
  // phase after the takeover settled.
  describe('identity contract (response + realtime event interleavings)', () => {
    test('realtime identity event with phase=restarting overrides a prior takeover response phase', async () => {
      terminalCalls.attach.mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalCols: 120,
          canonicalRows: 40,
        }),
      )
      terminalCalls.takeover.mockResolvedValueOnce(
        takeoverResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_local', status: 'connected' },
          phase: 'open',
        }),
      )
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      session.takeover()
      await flushUntil(() => terminalCalls.takeover.mock.calls.length > 0)
      expect(session.snapshot().phase).toBe('open')

      // PTY crashes mid-takeover — server pushes a realtime lifecycle
      // event with phase=restarting. After the identity/lifecycle
      // split, phase is on its own channel; the identity event no
      // longer carries phase at all. The client applies the
      // lifecycle event through `handleLifecycle` and the new
      // phase replaces the takeover response's phase.
      session.handleLifecycle({
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        phase: 'restarting',
        message: null,
        takeoverPending: false,
      })
      expect(session.snapshot().phase).toBe('restarting')
    })

    test('realtime identity event with a transitional phase does not destroy the controller xterm', async () => {
      // Reproduces the blank-on-create race: the user creates a slot,
      // the slot hydrates with role=controller and phase=open, and
      // then the server's realtime identity event arrives carrying
      // a transitional phase (opening) — even though the user is
      // still the controller by role. The previous `!canResize()`
      // gate misread the transitional phase as a controller→viewer
      // transition and tore down the freshly-opened xterm, leaving
      // the tab blank until refresh.
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      // Sanity: xterm is mounted under the active host, and the
      // user is the controller.
      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
      const xtermBefore = host.querySelector('.goblin-managed-terminal-host .xterm')
      expect(session.snapshot().attachment).toMatchObject({ role: 'controller' })

      // The server's realtime identity event arrives with role still
      // 'controller' but with a transitional phase ('opening'). The
      // role is the authoritative signal for who owns the PTY — the
      // phase just reflects whether the PTY is fully started. The
      // previous `!canResize()` gate misread this as a downgrade
      // because canResize() requires `phase === 'open'`.
      session.handleIdentity({
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,

      })

      // The role did not change, so the controller xterm must still
      // be mounted and attached. The pre-split `!canResize()` gate
      // misread a transitional phase update as a controller→viewer
      // transition; the post-split identity-only gate does not.
      const xtermAfter = host.querySelector('.goblin-managed-terminal-host .xterm')
      expect(xtermAfter).not.toBeNull()
      expect(xtermAfter).toBe(xtermBefore)
      // A subsequent lifecycle event with a transitional phase
      // (`opening` during a pre-spawn identity broadcast) is also
      // safe: the xterm is still preserved because `handleLifecycle`
      // never tears it down.
      session.handleLifecycle({
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        phase: 'opening',
        message: null,
        takeoverPending: false,
      })
      const xtermAfterLifecycle = host.querySelector('.goblin-managed-terminal-host .xterm')
      expect(xtermAfterLifecycle).not.toBeNull()
      expect(xtermAfterLifecycle).toBe(xtermBefore)
      expect(session.snapshot().phase).toBe('opening')
    })

    test('realtime identity event with role=viewer still tears down the controller xterm', async () => {
      // Companion to the previous test: the role-based gate must
      // still tear down the xterm when the user actually loses
      // control. The previous fix could not regress this path; this
      // test pins it down.
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new ManagedTerminalSlot(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()

      // Another client (or a viewer-mode switch) takes over: the
      // realtime event flips the role to 'viewer'. The phase is
      // 'open' here (not the transitional case), so canResize()
      // would also have flipped — the test exercises the role
      // signal independently of phase.
      session.handleIdentity({
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,

      })

      expect(session.snapshot().attachment).toMatchObject({ role: 'viewer' })
      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    })
  })
})

function createFirstFrame(
  ptySessionId: string,
  overrides: Partial<Omit<Extract<TerminalAttachResult, { ok: true }>, 'ok'>> = {},
): Extract<TerminalAttachResult, { ok: true }> {
  return {
    ptySessionId,
    snapshot: '',
    snapshotSeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalCols: 100,
    canonicalRows: 30,
    ...overrides,
    ok: true as const,
  }
}

function attachResult(
  ptySessionId: string,
  overrides: Partial<Omit<Extract<TerminalAttachResult, { ok: true }>, 'ok'>> = {},
): TerminalAttachResult {
  const result: Extract<TerminalAttachResult, { ok: true }> = {
    ptySessionId,
    snapshot: '',
    snapshotSeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    canonicalCols: 100,
    canonicalRows: 30,
    controller: { clientId: 'client_local', status: 'connected' },
    ...overrides,
    ok: true as const,
  }
  return result
}

function takeoverResult(
  ptySessionId: string,
  overrides: Partial<Extract<TerminalTakeoverResult, { ok: true }>> = {},
): TerminalTakeoverResult {
  return {
    ok: true,
    ptySessionId,
    role: 'controller',
    controllerStatus: 'connected',
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalCols: 100,
    canonicalRows: 30,
    phase: 'open',
    ...overrides,
  }
}

function hydrateManagedSession(
  session: ManagedTerminalSlot,
  overrides: Partial<{
    ptySessionId: string
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    processName: string
    canonicalTitle?: string | null
    role: 'controller' | 'viewer' | 'unowned'
    controllerStatus: 'connected' | 'none'
    canonicalCols: number
    canonicalRows: number
    snapshot: string
    snapshotSeq: number
  }> = {},
): void {
  session.hydrate({
    ptySessionId: 'pty_session_1_aaaaaaaaa',
    phase: 'open',
    message: null,
    processName: 'zsh',
    canonicalTitle: null,
    role: 'controller',
    controllerStatus: 'connected',
    canonicalCols: 100,
    canonicalRows: 30,
    snapshot: '',
    snapshotSeq: 0,
    ...overrides,
  })
}

function hydratedSnapshot(session: ManagedTerminalSlot): { snapshot: string; snapshotSeq: number } {
  return (session as unknown as { hydratedSnapshot: { snapshot: string; snapshotSeq: number } }).hydratedSnapshot
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
  // Drain any queued rAF/macrotask chains. runAllTimersAsync fires every pending
  // fake timer (including timers scheduled by other timer callbacks), then
  // awaits their resulting microtasks. This is what collapses the wall-time
  // cost of "wait for the rAF chain to settle" into microseconds.
  await vi.runAllTimersAsync()
}

async function flushResizeDispatch(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushFontRefit(): Promise<void> {
  // FONT_REMEASURE_DEBOUNCE_MS in the source is 80. Advance past it.
  await vi.advanceTimersByTimeAsync(100)
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await vi.runAllTimersAsync()
  }
  throw new Error('condition was not met')
}

afterEach(() => {
  vi.useRealTimers()
})
