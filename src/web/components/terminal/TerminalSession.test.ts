// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ILinkHandler } from '@xterm/xterm'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { terminalLog } from '#/web/logger.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-socket-connection.ts'
import { installTerminalThemeStyles } from '#/web/components/terminal/terminal-theme-test-utils.ts'
import { terminalOwnsKeyboardInput } from '#/web/terminal-focus.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type {
  TerminalMutationResult,
  TerminalResizeResult,
  TerminalNotifyBellInput,
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalSessionInput,
  TerminalTakeoverResult,
  TerminalTakeoverInput,
  TerminalWriteInput,
  TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { canonicalWorkspaceLocator, formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

vi.mock('#/web/client-page-id.ts', () => ({ readClientPageId: () => 'client_local' }))

const xtermMocks = vi.hoisted(() => {
  const terminals: any[] = []
  const fitAddons: any[] = []
  const searchAddons: any[] = []
  const unicodeAddons: any[] = []
  const webLinkAddons: any[] = []
  const imageAddons: any[] = []
  const progressAddons: any[] = []
  const deferredWriteCallbacks: Array<() => void> = []
  let deferWriteCallbacks = false
  let proposedDimensions: { cols: number; rows: number } | undefined = { cols: 100, rows: 30 }
  const addonFailures = {
    search: false,
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
    private renderHandlers: Array<(range: { start: number; end: number }) => void> = []
    refresh = vi.fn((start: number, end: number) => {
      requestAnimationFrame(() => {
        for (const handler of this.renderHandlers) handler({ start, end })
      })
    })
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

    onRender(cb: (range: { start: number; end: number }) => void) {
      this.renderHandlers.push(cb)
      return { dispose: vi.fn(() => (this.renderHandlers = this.renderHandlers.filter((handler) => handler !== cb))) }
    }

    emitRender(start = 0, end = this.rows - 1) {
      for (const handler of this.renderHandlers) handler({ start, end })
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

    emitTitleChange(title: string) {
      for (const handler of this.titleHandlers) handler(title)
    }
  }

  class MockFitAddon {
    term: MockTerminal | null = null
    proposeDimensions = vi.fn(() => proposedDimensions)
    dispose = vi.fn()

    constructor() {
      fitAddons.push(this)
    }

    activate(term: MockTerminal) {
      this.term = term
    }

    fit = vi.fn(() => {
      const dimensions = this.proposeDimensions()
      if (dimensions) this.term?.resize(dimensions.cols, dimensions.rows)
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
    unicodeAddons,
    webLinkAddons,
    imageAddons,
    progressAddons,
    addonFailures,
    deferWriteCallbacks(value: boolean) {
      deferWriteCallbacks = value
    },
    setProposedDimensions(value: { cols: number; rows: number } | undefined) {
      proposedDimensions = value
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
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: xtermMocks.MockUnicode11Addon }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: xtermMocks.MockWebLinksAddon }))

// jsdom does not lay out; mock font preload so the synchronous happy path resolves.
const geometryMocks = vi.hoisted(() => ({
  preloadTerminalFont: vi.fn(async () => {}),
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/components/terminal/terminal-geometry.ts')>(
    '#/web/components/terminal/terminal-geometry.ts',
  )
  return {
    ...actual,
    preloadTerminalFont: geometryMocks.preloadTerminalFont,
  }
})

class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  observe = vi.fn()
  unobserve = vi.fn()
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
  restart: vi.fn<(input: TerminalRestartInput) => Promise<TerminalRestartResult>>(),
  write: vi.fn<(input: TerminalWriteInput) => Promise<TerminalWriteResult>>(),
  resize: vi.fn<(input: TerminalResizeInput) => Promise<TerminalResizeResult>>(),
  takeover: vi.fn<(input: TerminalTakeoverInput) => Promise<TerminalTakeoverResult>>(),
  close: vi.fn<(input: TerminalSessionInput) => Promise<TerminalMutationResult>>(),
  notifyBell: vi.fn<(input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>>(),
  setBadge: vi.fn<(count: number) => void>(),
}
const invokeIpc = vi.fn<Window['goblinNative']['invokeIpc']>()
const hostOpenExternalUrl = vi.fn<NonNullable<Window['goblinNative']['host']>['openExternalUrl']>()
const mockFonts = new MockFontFaceSet()

function requiredWorkspaceLocator(input: string) {
  const locator =
    canonicalWorkspaceLocator(input) ??
    formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: input }, 'posix')
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

const descriptor: TerminalDescriptor = {
  terminalSessionId: 'term-111111111111111111111',
  index: 1,

  target: {
    kind: 'git-worktree' as const,
    workspaceId: requiredWorkspaceLocator('/repo'),
    workspaceRuntimeId: 'repo-runtime-test',
    root: requiredWorkspaceLocator('/worktree'),
  },
  presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature' } },
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
  xtermMocks.unicodeAddons.length = 0
  xtermMocks.webLinkAddons.length = 0
  xtermMocks.imageAddons.length = 0
  xtermMocks.progressAddons.length = 0
  xtermMocks.deferWriteCallbacks(false)
  xtermMocks.setProposedDimensions({ cols: 100, rows: 30 })
  xtermMocks.flushDeferredWriteCallbacks()
  Object.assign(xtermMocks.addonFailures, {
    search: false,
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
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      pathForFile: vi.fn(),
      onEvent: vi.fn(),
      host: {
        openSettingsWindow: vi.fn(),
        openExternalUrl: hostOpenExternalUrl.mockResolvedValue({ ok: true, message: 'https://example.com/path' }),
        openDirectoryDialog: vi.fn(),
        consumeExternalOpenPaths: vi.fn(),
      },
      terminal: {
        attach: terminalCalls.attach.mockResolvedValue(attachResult('pty_session_1_aaaaaaaaa')),
        restart: terminalCalls.restart.mockResolvedValue(restartResult('pty_session_1_aaaaaaaaa')),
        write: terminalCalls.write.mockResolvedValue({ status: 'accepted' }),
        resize: terminalCalls.resize.mockImplementation(async (input) => ({
          ok: true,
          terminalRuntimeSessionId: input.terminalRuntimeSessionId,
          terminalRuntimeGeneration: input.terminalRuntimeGeneration,
          canonicalSize: { cols: input.cols, rows: input.rows },
        })),
        takeover: terminalCalls.takeover.mockResolvedValue(takeoverResult('pty_session_1_aaaaaaaaa')),
        close: terminalCalls.close.mockResolvedValue(true),
        notifyBell: terminalCalls.notifyBell.mockResolvedValue(true),
        pruneTerminals: vi.fn(),
        onOutput: vi.fn(),
        onBell: vi.fn(),
        onTitle: vi.fn(),
        onExit: vi.fn(),
        onIdentity: vi.fn(),
        onLifecycle: vi.fn(),
        onSessionsChanged: vi.fn(),
        onSessionClosed: vi.fn(),
      },
    },
  })
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: (capability) =>
      capability === 'global-shortcut' ||
      capability === 'open-settings-window' ||
      capability === 'open-external-url' ||
      capability === 'open-directory-dialog' ||
      capability === 'consume-external-open-paths' ||
      capability === 'terminal-notifications' ||
      capability === 'terminal-badge',
    getBootstrap: () => ({
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    }),
    invokeIpc,
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    saveClipboardFiles: vi.fn(() => Promise.resolve([])),
    host: () => window.goblinNative.host ?? null,
    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: () => ({
      attach: terminalCalls.attach.mockResolvedValue(attachResult('pty_session_1_aaaaaaaaa')),
      restart: terminalCalls.restart.mockResolvedValue(restartResult('pty_session_1_aaaaaaaaa')),
      write: terminalCalls.write.mockResolvedValue({ status: 'accepted' }),
      resize: terminalCalls.resize.mockImplementation(async (input) => ({
        ok: true,
        terminalRuntimeSessionId: input.terminalRuntimeSessionId,
        terminalRuntimeGeneration: input.terminalRuntimeGeneration,
        canonicalSize: { cols: input.cols, rows: input.rows },
      })),
      takeover: terminalCalls.takeover.mockResolvedValue(takeoverResult('pty_session_1_aaaaaaaaa')),
      close: terminalCalls.close.mockResolvedValue(true),
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      recoverSessions: vi.fn(async () => ({ revision: 0, sessions: [] })),
      notifyBell: terminalCalls.notifyBell.mockResolvedValue(true),
      sendTestNotification: vi.fn(async () => true),
      setBadge: terminalCalls.setBadge,
      onOutput: vi.fn(() => () => {}),
      onBell: vi.fn(() => () => {}),
      onTitle: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
      onIdentity: vi.fn(() => () => {}),
      onLifecycle: vi.fn(() => () => {}),
      onSessionsChanged: vi.fn(() => () => {}),
      onSessionClosed: vi.fn(() => () => {}),
    }),
    workspacePaneTabs: () => ({
      replace: vi.fn(async () => ({ revision: 0, entries: [] })),
      update: vi.fn(async () => ({ revision: 0, entries: [] })),
      list: vi.fn(async () => ({ revision: 0, entries: [] })),
      onChanged: vi.fn(() => () => {}),
    }),
    workspacePaneRuntime: () => ({
      open: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
      close: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
    }),
  })
})

describe('TerminalSession', () => {
  test('opens xterm and attaches the primary terminal session with fitted dimensions', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
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

  test('does not open xterm until authoritative hydration supplies an addressable binding', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())

    session.attach(host)
    await Promise.resolve()

    expect(xtermMocks.terminals).toHaveLength(0)
    expect(terminalCalls.attach).not.toHaveBeenCalled()

    hydrateManagedSession(session)
    await flushTerminalStart()

    expect(xtermMocks.terminals).toHaveLength(1)
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
  })

  test('bounds fitted geometry at the shared protocol limit before the first attach', async () => {
    xtermMocks.setProposedDimensions({ cols: 700, rows: 400 })
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { canonicalSize: { cols: 500, rows: 300 } }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    await flushTerminalStart()
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(xtermMocks.terminals[0]).toMatchObject({ cols: 500, rows: 300 })
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 500,
      rows: 300,
    })
  })

  test('keeps the fitted xterm hidden until its full viewport render completes', async () => {
    const attach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(term.refresh).not.toHaveBeenCalled()

    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    await flushTerminalStart()

    expect(term.refresh).toHaveBeenCalledWith(0, 29)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('never reveals a fitted xterm superseded while its final render is pending', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
  })

  test('remeasures a pending presentation before reveal and recovers at the current layout', async () => {
    const firstAttach = deferred<TerminalAttachResult>()
    terminalCalls.attach
      .mockReturnValueOnce(firstAttach.promise)
      .mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { canonicalSize: { cols: 90, rows: 25 } }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    const fitAddon = xtermMocks.fitAddons[0]!
    firstAttach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)

    fitAddon.proposeDimensions.mockReturnValue({ cols: 90, rows: 25 })
    await flushTerminalStart()
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(1, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 90,
      rows: 25,
    })
    expect(term.cols).toBe(90)
    expect(term.rows).toBe(25)
  })

  test('keeps the fresh xterm intact and renders realtime output from sequence 1', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })

    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    expect(notify).toHaveBeenCalledWith('projection-delta-revision', 1)
    expect(term.reset).not.toHaveBeenCalled()
    expect(term.write).not.toHaveBeenCalled()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: descriptor.terminalSessionId,
      data: 'prompt',
      seq: 1,
      processName: 'zsh',
    })
    await flushTerminalStart()

    expect(term.reset).not.toHaveBeenCalled()
    expect(term.write).toHaveBeenCalledWith('prompt', expect.any(Function))
  })

  test('does not transfer automatic focus to a fresh stream until real output has rendered', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    term.emitUserData('typed-before-render')
    await flushResizeDispatch()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.write).not.toHaveBeenCalled()
    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    term.refresh.mockImplementationOnce(() => {})
    emitSessionOutput(session, 1, 'prompt')
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('prompt', expect.any(Function))
    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    term.emitRender()
    await flushTerminalStart()

    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
    term.emitUserData('l')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'l',
    })
  })

  test('keeps a quiet fresh stream visible and allows an explicit focus request', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.write).not.toHaveBeenCalled()
    expect(term.focus).not.toHaveBeenCalled()

    session.focus()
    term.emitUserData('input for quiet process')
    await flushUntil(() => terminalCalls.write.mock.calls.length === 1)

    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'input for quiet process',
    })
  })

  test('drops an automatic focus transfer invalidated by keyboard activity before fresh output', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })
    let focusIsCurrent = true
    const settled = vi.fn()

    session.focus({ isCurrent: () => focusIsCurrent, onSettled: settled })
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    focusIsCurrent = false

    emitSessionOutput(session, 1, 'prompt')
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('prompt', expect.any(Function))
    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('flushes current-generation stream output that arrives during the final render exactly once', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })

    session.attach(host)
    await flushMicrotasksUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
    const term = xtermMocks.terminals[0]!
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)

    emitSessionOutput(session, 1, 'current prompt')
    expect(term.write).not.toHaveBeenCalled()
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')

    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.write).toHaveBeenCalledWith('current prompt', expect.any(Function))
    await flushTerminalStart()
    expect(term.write).toHaveBeenCalledTimes(1)
  })

  test('ignores stale-generation output while a fresh stream presentation is pending', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })

    session.attach(host)
    await flushMicrotasksUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
    const term = xtermMocks.terminals[0]!
    emitSessionOutput(session, 0, 'stale prompt')
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)

    expect(term.write).not.toHaveBeenCalled()
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    emitSessionOutput(session, 1, 'current prompt')
    await flushUntil(() => term.write.mock.calls.length === 1)

    expect(term.write).toHaveBeenCalledWith('current prompt', expect.any(Function))
  })

  test('cancels a fresh stream presentation that detaches before its viewport render', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })

    session.attach(host)
    await flushMicrotasksUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
    const term = xtermMocks.terminals[0]!
    await flushMicrotasksUntil(() => term.refresh.mock.calls.length === 1)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    session.detach(host)
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.write).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('keeps a prepared server session opening while the local xterm attach is pending', async () => {
    const attach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    expect(session.snapshot().phase).toBe('opening')

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot().phase).toBe('opening')
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(terminalCalls.resize).not.toHaveBeenCalled()
    xtermMocks.terminals[0]!.emitData('typed-before-attach')
    await flushTerminalStart()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().phase).toBe('open')
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(notify).not.toHaveBeenCalledWith('projection-delta-revision', expect.any(Number))
  })

  test('drops xterm resize and input mutations until snapshot replay has committed', async () => {
    xtermMocks.deferWriteCallbacks(true)
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'screen' }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    term.resize(90, 25)
    term.emitUserData('typed-during-replay')
    await flushTerminalStart()

    expect(terminalCalls.resize).not.toHaveBeenCalled()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')
    await flushTerminalStart()

    expect(terminalCalls.resize).not.toHaveBeenCalled()
  })

  test('does not treat an existing error snapshot attach as an operation-owned delta', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        phase: 'error',
        message: 'process unavailable',
        canonicalSize: { cols: 80, rows: 24 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => session.snapshot().phase === 'error')
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(terminalCalls.attach).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalledWith('projection-delta-revision', expect.any(Number))
  })

  test('does not attach or reveal when the host becomes unmeasurable before fit', async () => {
    const measurableRect = {
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      bottom: 400,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
    const hiddenRect = { ...measurableRect, width: 0, height: 0, right: 0, bottom: 0 } as DOMRect
    vi.mocked(HTMLElement.prototype.getBoundingClientRect)
      .mockImplementationOnce(() => measurableRect)
      .mockReturnValue(hiddenRect)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
  })

  test('fences resize and restart requests to the retiring generation', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    terminalCalls.resize.mockClear()

    xtermMocks.terminals[0]!.resize(90, 25)
    await Promise.resolve()
    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.resize).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 90,
      rows: 25,
    })
  })

  test('does not close the server session when deselected while attach is in flight', async () => {
    const attach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    session.detach(host)
    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(terminalCalls.close).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalledWith('projection-delta-revision', expect.any(Number))
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('dispose during font preload aborts before waitForMeasurableHost runs', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    // Hold preloadTerminalFont so the orchestrator yields mid-openPhase.
    let resolvePreload!: () => void
    geometryMocks.preloadTerminalFont.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolvePreload = r
        }),
    )

    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    // The frame owns its observer before xterm starts opening.
    expect(MockResizeObserver.instances).toHaveLength(1)

    // Dispose while the preload promise is unresolved. Then resolve it.
    session.dispose()
    resolvePreload()
    await flushTerminalStart()

    // The guard after the preload await catches the disposed state before
    // xterm creation, and frame disposal releases the already-owned observer.
    expect(MockResizeObserver.instances).toHaveLength(1)
    expect(MockResizeObserver.instances[0]!.disconnect).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals).toHaveLength(0)
  })

  test('does not dispatch attach after the view detaches during font preload', async () => {
    const preload = deferred<void>()
    geometryMocks.preloadTerminalFont.mockReturnValueOnce(preload.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushMicrotasksUntil(() => geometryMocks.preloadTerminalFont.mock.calls.length === 1)
    session.detach(host)
    preload.resolve()
    await flushTerminalStart()

    expect(terminalCalls.attach).not.toHaveBeenCalled()
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(0)
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('remeasures and refits after fonts finish loading', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    const fitAddon = xtermMocks.fitAddons[0]!
    term.refresh.mockClear()
    fitAddon.proposeDimensions.mockClear()

    mockFonts.resolveReady()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.refresh).not.toHaveBeenCalled()

    term.refresh.mockClear()
    fitAddon.proposeDimensions.mockClear()

    mockFonts.emitLoadingDone()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.refresh).not.toHaveBeenCalled()
  })

  test('does not force scroll position across font refits', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    const fitAddon = xtermMocks.fitAddons[0]!
    term.scrollToBottom.mockClear()
    fitAddon.proposeDimensions.mockClear()

    mockFonts.resolveReady()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  test('does not resize or scroll the discarded xterm when attach resolves as viewer', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  test('loads terminal addons and exposes search', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(xtermMocks.unicodeAddons).toHaveLength(1)
    expect(xtermMocks.terminals[0]!.unicode.activeVersion).toBe('11')
    expect(xtermMocks.webLinkAddons).toHaveLength(1)
    expect(xtermMocks.searchAddons).toHaveLength(1)
    expect(session.findNext('needle', true)).toEqual({ resultIndex: 0, resultCount: 2, found: true })
    expect(xtermMocks.searchAddons[0]!.findNext).toHaveBeenCalledWith(
      'needle',
      expect.objectContaining({ incremental: true, caseSensitive: false }),
    )
    expect(session.findPrevious('needle')).toEqual({ resultIndex: 0, resultCount: 2, found: true })
    expect(session.findNext('missing')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
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
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)

      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const term = xtermMocks.terminals[0]!
      expect(term.options.macOptionIsMeta).toBe(true)
      expect(term.customKeyEventHandler).toBeTypeOf('function')
      term.scrollToBottom.mockClear()

      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowRight'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowUp'))).toBe(false)
      expect(term.customKeyEventHandler?.(optionArrow('ArrowDown'))).toBe(false)
      expect(term.scrollToBottom).toHaveBeenCalledTimes(4)
      await flushTerminalStart()

      // Rapid option-arrow keys are batched into a single write via queueMicrotask.
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        data: '\x1bb\x1bf\x1b[A\x1b[B',
      })

      term.modes.applicationCursorKeysMode = true
      term.scrollToBottom.mockClear()
      expect(term.customKeyEventHandler?.(optionArrow('ArrowLeft'))).toBe(true)
      expect(term.scrollToBottom).not.toHaveBeenCalled()
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
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const term = xtermMocks.terminals[0]!
      expect(term.customKeyEventHandler).toBeTypeOf('function')
      term.scrollToBottom.mockClear()

      // Safari reports unshifted '/' for Shift+Slash — workaround should send '?'.
      const slashEvent = new KeyboardEvent('keydown', { key: '/', code: 'Slash', shiftKey: true, cancelable: true })
      expect(term.customKeyEventHandler?.(slashEvent)).toBe(false)

      // Safari reports empty key for Shift+Digit1 — workaround should send '!'.
      const digit1Event = new KeyboardEvent('keydown', { key: '', code: 'Digit1', shiftKey: true, cancelable: true })
      expect(term.customKeyEventHandler?.(digit1Event)).toBe(false)
      expect(term.scrollToBottom).toHaveBeenCalledTimes(2)

      await flushTerminalStart()

      // Rapid Safari shift keys are batched into a single write via queueMicrotask.
      expect(terminalCalls.write).toHaveBeenCalledTimes(1)
      expect(terminalCalls.write).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        data: '?!',
      })
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
      const session = new TerminalSession(descriptor, vi.fn())
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
      expect(terminalCalls.write).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        data: '：',
      })
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
      const session = new TerminalSession(descriptor, vi.fn())
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
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/path')
    await Promise.resolve()

    expect(hostOpenExternalUrl).toHaveBeenCalledWith({ url: 'https://example.com/path', allowHttp: true })
  })

  test('opens OSC 8 hyperlinks through the safe shell bridge', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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
    expect(hostOpenExternalUrl).toHaveBeenCalledWith({ url: 'https://example.com/osc8', allowHttp: true })
  })

  test('does not send unsafe web links to the app ipc', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    xtermMocks.webLinkAddons[0]!.open('javascript:alert(1)')
    xtermMocks.webLinkAddons[0]!.open('file:///tmp/secret')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/\u0000bad')
    await Promise.resolve()

    expect(hostOpenExternalUrl).not.toHaveBeenCalled()
  })

  test('opens terminal when optional addon setup fails', async () => {
    Object.assign(xtermMocks.addonFailures, {
      search: true,
      unicode: true,
      webLinks: true,
      image: true,
      progress: true,
    })
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(terminalCalls.attach).toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
    expect(session.findNext('needle')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    expect(warnSpy).toHaveBeenCalledWith('failed to load unicode11 addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load web links addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load search addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load image addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load progress addon', { err: expect.any(Error) })
    expect(session.snapshot().progress).toBeUndefined()
    warnSpy.mockRestore()
  })

  test('uses first-class restart IPC instead of recreating through ensureSession', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
  })

  test('keeps a replacement xterm hidden until the restart stream presentation commits', async () => {
    const restart = deferred<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')

    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(xtermMocks.terminals.at(-1)!.reset).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()
  })

  test('rejects a duplicate restart while the admitted request is in flight', async () => {
    const restart = deferred<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)

    expect(terminalCalls.restart).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals).toHaveLength(2)
    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')
  })

  test('continues an admitted restart when a zero-sized host becomes measurable', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    terminalCalls.restart.mockClear()

    const hiddenRect = {
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(hiddenRect)
    session.restart()
    await flushTerminalStart()
    expect(terminalCalls.restart).not.toHaveBeenCalled()

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      ...hiddenRect,
      width: 800,
      height: 400,
      right: 800,
      bottom: 400,
    })
    const resizeObserver = MockResizeObserver.instances[0]
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.cb([], resizeObserver)
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)

    expect(terminalCalls.restart).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
  })

  test('does not let an old xterm write callback block a replacement presentation', async () => {
    xtermMocks.deferWriteCallbacks(true)
    terminalCalls.attach.mockResolvedValueOnce(attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'old screen' }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushMicrotasksUntil(() => xtermMocks.terminals[0]?.write.mock.calls.length === 1)

    xtermMocks.deferWriteCallbacks(false)
    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(xtermMocks.terminals).toHaveLength(2)
    expect(xtermMocks.terminals[1]!.refresh).toHaveBeenCalledWith(0, 29)
    xtermMocks.flushDeferredWriteCallbacks()
  })

  test('keeps the server session addressable when restart fails', async () => {
    terminalCalls.restart.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()

    expect(session.currentTerminalRuntimeSessionId()).toBeNull()
    expect(session.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(session.snapshot()).toMatchObject({
      phase: 'error',
      message: 'error.spawn-failed',
      processName: 'zsh',
      canonicalTitle: null,
      attachment: { role: 'controller' },
    })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('retries a failed restart from the retained generation and publishes exactly old plus one', async () => {
    terminalCalls.restart
      .mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
      .mockResolvedValueOnce(restartResult('pty_session_1_aaaaaaaaa'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushTerminalStart()
    expect(session.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledTimes(2)
    expect(terminalCalls.restart.mock.calls.map(([input]) => input.terminalRuntimeGeneration)).toEqual([1, 1])
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
    })
  })

  test('retries a failed prepared attach through attach instead of restart', async () => {
    terminalCalls.attach.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot()).toMatchObject({
      phase: 'error',
      message: 'error.spawn-failed',
      processName: 'zsh',
      canonicalTitle: null,
      attachment: { role: 'unowned' },
    })

    session.restart()
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('open')
  })

  test('does not retry an error session when a later layout notification arrives', async () => {
    terminalCalls.attach.mockResolvedValueOnce({ ok: false, message: 'error.spawn-failed' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    expect(session.snapshot().phase).toBe('error')
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    MockResizeObserver.instances[0]!.cb([], MockResizeObserver.instances[0]!)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
    expect(session.snapshot().phase).toBe('error')
  })

  test('does not turn a local attach transport failure into authoritative runtime error metadata', async () => {
    terminalCalls.attach.mockRejectedValueOnce(new Error('transport unavailable'))
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    session.attach(host)
    await flushTerminalStart()

    expect(session.snapshot().phase).toBe('open')
    expect(session.addressableRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('terminal start request failed before an authoritative response', {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      operation: 'attach',
      error: expect.any(Error),
    })
    warnSpy.mockRestore()
  })

  test('recovers indeterminate prepared attach from authoritative generation without retrying generation zero', async () => {
    terminalCalls.attach
      .mockRejectedValueOnce(
        new ClientRealtimeRequestError('socket disconnected', {
          kind: 'disconnected',
          delivery: 'indeterminate',
          outageId: 1,
        }),
      )
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          terminalRuntimeGeneration: 1,
          snapshot: 'authoritative recovery',
        }),
      )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    const pending = session.pendingAuthoritativeRuntimeBinding()
    expect(pending).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(session.commitPendingAuthoritativeHydration(pending!)).toBe(true)
    session.resynchronizeConnectedView()
    await flushTerminalStart()

    expect(terminalCalls.attach.mock.calls).toEqual([
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 0,
          cols: 100,
          rows: 30,
        },
      ],
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      ],
    ])
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('authoritative recovery', expect.any(Function))
  })

  test('continues after terminal write failures', async () => {
    terminalCalls.write.mockRejectedValueOnce(new Error('write failed'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitData('input')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'input',
    })
    expect(session.snapshot().phase).toBe('open')
  })

  test('reports a resolved terminal write rejection', async () => {
    terminalCalls.write.mockResolvedValueOnce({ status: 'rejected' })
    const report = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn(), { report })
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.emitData('input')
    await flushTerminalStart()

    expect(report).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      failure: { kind: 'result', result: { status: 'rejected' } },
    })
  })

  test('batches rapid user input into a single ordered write', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'clear',
    })
  })

  test('drops buffered input after dispose', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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

  test.each([
    'server rejection',
    'transport failure',
    'session mismatch',
    'generation mismatch',
    'canonical size mismatch',
  ] as const)('rebuilds the view from an authoritative snapshot after a resize %s', async (failure) => {
    if (failure === 'server rejection') {
      terminalCalls.resize.mockResolvedValueOnce({ ok: false, message: 'error.unavailable' })
    } else if (failure === 'transport failure') {
      terminalCalls.resize.mockRejectedValueOnce(new Error('resize failed'))
    } else {
      terminalCalls.resize.mockResolvedValueOnce({
        ok: true,
        terminalRuntimeSessionId:
          failure === 'session mismatch' ? 'pty_session_2_bbbbbbbbb' : 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: failure === 'generation mismatch' ? 2 : 1,
        canonicalSize: failure === 'canonical size mismatch' ? { cols: 102, rows: 32 } : { cols: 101, rows: 31 },
      })
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'recovered after resize',
        snapshotSeq: 1,
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )

    const invalidatedTerm = xtermMocks.terminals[0]!
    invalidatedTerm.resize(101, 31)
    await flushResizeDispatch()
    await flushTerminalStart()

    expect(terminalCalls.resize).toHaveBeenCalledOnce()
    expect(terminalCalls.resize).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 101,
      rows: 31,
    })
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(invalidatedTerm.dispose).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('recovered after resize', expect.any(Function))
    expect(session.snapshot().phase).toBe('open')
  })

  test('serializes resize commits and keeps only the latest proposal while one is in flight', async () => {
    const firstResize = deferred<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(firstResize.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.resize(101, 31)
    await flushMicrotasksUntil(() => terminalCalls.resize.mock.calls.length === 1)
    term.resize(102, 32)
    term.resize(103, 33)
    await flushResizeDispatch()
    expect(terminalCalls.resize).toHaveBeenCalledOnce()

    firstResize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushMicrotasksUntil(() => terminalCalls.resize.mock.calls.length === 2)

    expect(terminalCalls.resize).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 103,
      rows: 33,
    })
  })

  test('does not let a stale resize acknowledgement regress newer controller geometry', async () => {
    const resize = deferred<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(resize.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushUntil(() => terminalCalls.resize.mock.calls.length === 1)
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    notify.mockClear()
    resize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushTerminalStart()

    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    expect(notify).not.toHaveBeenCalled()
  })

  test('does not send resize or input while attached as a mirror page before explicit takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
  })

  test('renders the recovery snapshot for a newly hydrated controller binding', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('term-remoteremoteremote001', {
        snapshot: 'hydrated-screen',
        snapshotSeq: 5,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('hydrated-screen', expect.any(Function))
  })

  test('destroys the active controller view when full hydration changes binding ownership to viewer', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!

    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
  })

  test('drops pending output from the retired binding before recovering a hydrated controller', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const oldTerm = xtermMocks.terminals[0]!
    oldTerm.write.mockClear()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'old-pending-output',
      seq: 1,
      processName: 'zsh',
    })
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('term-remoteremoteremote001', {
        processName: 'node',
        snapshot: 'remote-screen',
        snapshotSeq: 5,
      }),
    )

    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    await flushTerminalStart()

    expect(oldTerm.dispose).toHaveBeenCalledOnce()
    expect(oldTerm.write).not.toHaveBeenCalled()
    expect(xtermMocks.terminals[1]!.write.mock.calls.map(([data]: unknown[]) => data)).toEqual(['remote-screen'])
  })

  test('keeps the active xterm when full hydration refreshes metadata for the same binding', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    term.write.mockClear()

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()

    expect(term.dispose).not.toHaveBeenCalled()
    expect(term.write).not.toHaveBeenCalled()
    expect(session.snapshot().processName).toBe('node')
  })

  test('does not notify on ordinary input while already attached', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    xtermMocks.terminals[0]!.emitData('hello')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'hello',
    })
    expect(notify).not.toHaveBeenCalled()
  })

  test('uses a captured input writer for the active presented generation', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')
    inputWriter("bat '/worktree/file.ts'\r")
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: "bat '/worktree/file.ts'\r",
    })
  })

  test('commits asynchronous input only to the generation that admitted it', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    session.attach(host)
    await flushTerminalStart()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.restart()

    inputWriter("'/tmp/from-old-generation'")
    await flushTerminalStart()
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('drops a captured input writer after the presentation is replaced on the same generation', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    session.attach(host)
    await flushTerminalStart()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.detach(host)
    session.attach(host)
    await flushTerminalStart()
    inputWriter("'/tmp/from-old-presentation'")
    await Promise.resolve()

    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('tracks server title changes separately from process name', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
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
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    xtermMocks.terminals[0]!.emitData('blocked')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
    expect(notify).not.toHaveBeenCalled()
  })

  test('joins concurrent takeover callers to one server mutation', async () => {
    const takeoverResponse = deferred<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    const first = session.takeover()
    const second = session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length === 1)

    expect(session.snapshot().takeoverPending).toBe(true)
    takeoverResponse.resolve(takeoverResult('pty_session_1_aaaaaaaaa'))
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(terminalCalls.takeover).toHaveBeenCalledOnce()
    expect(session.snapshot().takeoverPending).toBeUndefined()
  })

  test('reports a committed takeover as successful when its recovery presentation fails', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(takeoverResult('pty_session_1_aaaaaaaaa'))
    terminalCalls.attach.mockResolvedValueOnce({ ok: false, message: 'recovery unavailable' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    await expect(session.takeover()).resolves.toBe(true)
    await flushTerminalStart()

    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
  })

  test('takeover response is the authoritative handshake (no realtime event required)', async () => {
    // After the takeover atomicity follow-up, the `terminal.takeover`
    // response carries role/controllerStatus/canonicalSize/phase
    // and is applied synchronously. The client does NOT have to
    // wait for a realtime `identity` event before painting the
    // post-takeover frame. A subsequent realtime event for the same
    // session is idempotent.
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 101, rows: 31 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushResizeDispatch()
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    // No realtime identity event is needed; takeover and its recovery
    // attach commit the fitted controller view in one presentation.
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })

    // A later realtime identity event for the same session is a
    // benign re-apply — the runtime treats it as idempotent because
    // every field already matches.
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('takeover response starts a controller view for a hydrated viewer without a realtime event', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
        snapshot: 'post-takeover-screen',
        snapshotSeq: 8,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    expect(xtermMocks.terminals).toHaveLength(0)

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals).toHaveLength(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('post-takeover-screen', expect.any(Function))
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('commits takeover after detach and lets the remounted view recover the authoritative controller', async () => {
    const takeoverResponse = deferred<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'post-takeover recovery',
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    const takeover = session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length === 1)
    session.detach(host)
    session.attach(host)
    takeoverResponse.resolve(takeoverResult('pty_session_1_aaaaaaaaa'))
    await expect(takeover).resolves.toBe(true)
    await flushTerminalStart()

    expect(terminalCalls.takeover).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('post-takeover recovery', expect.any(Function))
  })

  test('mounting a hydrated unowned session attaches and auto-claims without manual takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals).toHaveLength(1)
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('mounted viewer hydrate to unowned auto-attaches without manual takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
        snapshot: 'reclaimed-after-hydrate',
        snapshotSeq: 10,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(1, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('reclaimed-after-hydrate', expect.any(Function))
  })

  test('takeover measures a hidden xterm instead of using canonical size as a fallback', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    session.attach(host)

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.takeover).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
  })

  test('reconciles mismatched recovery geometry back to the fitted takeover xterm', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 132, rows: 43 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 132, rows: 43 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.attach).toHaveBeenCalledTimes(3)
    expect(terminalCalls.attach).toHaveBeenNthCalledWith(3, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('post-takeover recovery attach propagates lifecycle phase into the runtime view', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_local', status: 'connected' },
          phase: 'restarting',
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
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(session.snapshot().phase).toBe('restarting')
  })

  test('realtime identity event is the authority for non-takeover paths', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: null,
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })

    expect(session.snapshot().phase).toBe('open')
    expect(session.snapshot().attachment).toMatchObject({ role: 'unowned' })
  })

  test('mounted viewer auto-attaches when realtime identity flips to unowned', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
          snapshot: 'reclaimed-screen',
          snapshotSeq: 9,
        }),
      )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('reclaimed-screen', expect.any(Function))
  })

  test('starts a generation-fenced recovery attach when identity grants local control', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
  })

  test('drops terminal-emulator input while replay is being written', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'history', snapshotSeq: 1 }),
    )
    xtermMocks.deferWriteCallbacks(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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

  test('drops xterm core-attributed user input while replay is being written', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'history', snapshotSeq: 1 }),
    )
    xtermMocks.deferWriteCallbacks(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'history'))

    xtermMocks.terminals[0]!.emitCoreUserData('input during replay')
    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => session.snapshot().phase === 'open')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('drops xterm binary mouse input while replay is being written', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'history', snapshotSeq: 1 }),
    )
    xtermMocks.deferWriteCallbacks(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'history'))

    xtermMocks.terminals[0]!.emitBinary('\x1b[M ##')
    xtermMocks.flushDeferredWriteCallbacks()
    xtermMocks.deferWriteCallbacks(false)
    await flushUntil(() => session.snapshot().phase === 'open')
    await flushTerminalStart()

    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('resets the terminal before replaying the snapshot', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'tail', snapshotSeq: 1 }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => xtermMocks.terminals[0]?.write.mock.calls.some((call: unknown[]) => call[0] === 'tail'))

    expect(xtermMocks.terminals[0]!.reset).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('tail', expect.any(Function))
  })

  test('does not write realtime output already covered by the attached snapshot', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'prompt', snapshotSeq: 1 }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    term.write.mockClear()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'prompt',
      seq: 1,
      processName: 'zsh',
    })
    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'next',
      seq: 2,
      processName: 'zsh',
    })
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.write).toHaveBeenCalledWith('next', expect.any(Function))
  })

  test('batches terminal output writes on animation frames', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')
    notify.mockClear()

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_otheraaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-999999999999999999999',
      data: 'ignored',
      seq: 1,
      processName: 'zsh',
    })
    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'first',
      seq: 1,
      processName: 'zsh',
    })
    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'second',
      seq: 2,
      processName: 'zsh',
    })

    // Controller mode: metadata doesn't change (processName was already set during attach)
    expect(notify).toHaveBeenCalledTimes(0)
    expect(xtermMocks.terminals[0]!.write).not.toHaveBeenCalled()
    await flushTerminalStart()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('firstsecond', expect.any(Function))
  })

  test('flushes matching terminal exits before the provider dismisses the session', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleOutput({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'before exit',
      seq: 1,
      processName: 'zsh',
    })
    expect(
      session.handleExit({
        terminalRuntimeSessionId: 'pty_session_otheraaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-999999999999999999999',
        workspaceId: requiredWorkspaceLocator('/repo'),
        workspaceRuntimeId: 'repo-runtime-1',
      }),
    ).toBe(false)
    expect(
      session.handleExit({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: requiredWorkspaceLocator('/repo'),
        workspaceRuntimeId: 'repo-runtime-1',
      }),
    ).toBe(true)
    session.dispose()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('before exit', expect.any(Function))
    expect(session.snapshot()).toMatchObject({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('keeps hydrated title when selecting a mirrored session', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    session.attach(host)

    expect(session.snapshot()).toMatchObject({
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
  })

  test('does not issue a direct close when disposed before restart reaches main', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    session.dispose()
    await flushTerminalStart()
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('does not issue a direct close for a stale restart response after disposal', async () => {
    const restart = deferred<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    session.dispose()
    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('commits an in-flight restart once and remounts through generation recovery', async () => {
    const restart = deferred<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    session.restart()
    await flushUntil(() => terminalCalls.restart.mock.calls.length === 1)
    session.detach(host)
    restart.resolve(restartResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(terminalCalls.close).not.toHaveBeenCalled()
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
    })
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()

    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { terminalRuntimeGeneration: 2, snapshot: 'recovered generation 2' }),
    )
    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 2)
    await flushTerminalStart()

    expect(terminalCalls.restart).toHaveBeenCalledTimes(1)
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('recovered generation 2', expect.any(Function))
  })

  test('does not let a remounted view consume the origin prepared-attach stream', async () => {
    const attach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'recovered generation 1',
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
    session.detach(host)
    session.attach(host)
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 2)
    await flushTerminalStart()

    expect(terminalCalls.attach.mock.calls).toEqual([
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 0,
          cols: 100,
          rows: 30,
        },
      ],
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      ],
    ])
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(2)
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[1]!.write).toHaveBeenCalledWith('recovered generation 1', expect.any(Function))
  })

  test('waits an older operation before recovering exactly once to a future authoritative generation', async () => {
    const oldAttach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(oldAttach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 2,
        snapshot: 'generation 2 recovery',
      }),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    const pending = session.pendingAuthoritativeRuntimeBinding()
    expect(pending).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 2,
    })
    expect(session.commitPendingAuthoritativeHydration(pending!)).toBe(true)

    oldAttach.resolve(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'obsolete generation 1 frame',
      }),
    )
    await flushTerminalStart()

    expect(terminalCalls.attach.mock.calls).toEqual([
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      ],
      [
        {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 2,
          cols: 100,
          rows: 30,
        },
      ],
    ])
    expect(xtermMocks.terminals[0]!.write).not.toHaveBeenCalledWith('obsolete generation 1 frame', expect.any(Function))
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('generation 2 recovery', expect.any(Function))
  })

  test('keeps a committed binding when presentation fails and recovers it on the next layout', async () => {
    const attach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const firstTerm = xtermMocks.terminals[0]!
    const firstFit = xtermMocks.fitAddons[0]!
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await flushMicrotasksUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
    await flushMicrotasksUntil(() => firstTerm.refresh.mock.calls.length === 1)
    firstFit.proposeDimensions.mockReturnValue(null)
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    await flushTerminalStart()

    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(firstTerm.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      bottom: 400,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'recovered committed binding',
      }),
    )
    const resizeObserver = MockResizeObserver.instances.at(-1)
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.cb([], resizeObserver)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(terminalCalls.attach).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(xtermMocks.terminals.at(-1)!.write).toHaveBeenCalledWith('recovered committed binding', expect.any(Function))
  })

  test('destroys inactive xterm and opens a fresh view on attach', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const firstObserver = MockResizeObserver.instances[0]!
    const firstTerm = xtermMocks.terminals[0]!

    session.detach(host)
    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1)
    expect(firstTerm.dispose).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()

    session.attach(host)
    await flushTerminalStart()
    expect(MockResizeObserver.instances).toHaveLength(2)
    expect(MockResizeObserver.instances[1]!.observe).toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(2)
    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
  })

  test('focus checks are derived from the xterm DOM host', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    xtermMocks.terminals[0]!.focus()
    expect(terminalOwnsKeyboardInput()).toBe(true)
  })

  test('settles a focus lease only after the hidden xterm is fully presented', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!

    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    await flushTerminalStart()

    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('settles a focus lease when its initial currency check throws', () => {
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    expect(() =>
      session.focus({
        isCurrent: () => {
          throw new Error('focus currency check failed')
        },
        onSettled: settled,
      }),
    ).toThrow('focus currency check failed')
    expect(settled).toHaveBeenCalledOnce()
  })

  test('settles a focus lease when xterm focus fails during presentation', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    xtermMocks.terminals[0]!.focus.mockImplementationOnce(() => {
      throw new Error('focus failed')
    })
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
  })

  test('releases a pending focus lease when the hidden presentation detaches', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    session.detach(host)
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('releases a pending focus lease when controller ownership changes to viewer', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('releases a pending focus lease when an authoritative binding supersedes the candidate', async () => {
    const attach = deferred<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.focus({ isCurrent: () => true, onSettled: settled })
    session.attach(host)
    await flushMicrotasksUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      phase: 'open',
      message: null,
      processName: 'node',
      canonicalTitle: null,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    const pending = session.pendingAuthoritativeRuntimeBinding()
    if (!pending) throw new Error('expected pending authoritative binding')
    expect(session.commitPendingAuthoritativeHydration(pending)).toBe(true)
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('applies terminal theme and updates when the app theme changes', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(xtermMocks.imageAddons).toHaveLength(1)
    expect(xtermMocks.progressAddons).toHaveLength(1)
  })

  test('progress state appears in snapshot and clears on state 0', async () => {
    const notify = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, notify)
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
    const session = new TerminalSession(descriptor, vi.fn())
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
    const session = new TerminalSession(descriptor, vi.fn())
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

  test('progress state is cleared and published on detach', async () => {
    const notify = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, notify)
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.progressAddons[0]!.emitProgress(1, 75)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.detach(host)

    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('progress value is clamped to 0-100', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const session = new TerminalSession(descriptor, vi.fn())
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
          canonicalSize: { cols: 120, rows: 40 },
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
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const takeover = session.takeover()
      await flushTerminalStart()
      await expect(takeover).resolves.toBe(true)
      expect(session.snapshot().phase).toBe('open')

      // PTY crashes mid-takeover — server pushes a realtime lifecycle
      // event with phase=restarting. After the identity/lifecycle
      // split, phase is on its own channel; the identity event no
      // longer carries phase at all. The client applies the
      // lifecycle event through `handleLifecycle` and the new
      // phase replaces the takeover response's phase.
      session.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'restarting',
        message: null,
      })
      expect(session.snapshot().phase).toBe('restarting')
    })

    test('realtime identity event with a transitional phase does not destroy the controller xterm', async () => {
      // Reproduces the blank-on-create race: the user creates a session,
      // the session hydrates with role=controller and phase=open, and
      // then the server's realtime identity event arrives carrying
      // a transitional phase (opening) — even though the user is
      // still the controller by role. The previous `!canResize()`
      // gate misread the transitional phase as a controller→viewer
      // transition and tore down the freshly-opened xterm, leaving
      // the tab blank until refresh.
      const host = document.createElement('div')
      document.body.appendChild(host)
      const session = new TerminalSession(descriptor, vi.fn())
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
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
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
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'opening',
        message: null,
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
      const session = new TerminalSession(descriptor, vi.fn())
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
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })

      expect(session.snapshot().attachment).toMatchObject({ role: 'viewer' })
      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    })
  })
})

function attachResult(
  terminalRuntimeSessionId: string,
  overrides: Partial<
    Omit<Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }>, 'ok' | 'frame' | 'terminalProjectionEffect'>
  > = {},
): Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> {
  const result: Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> = {
    frame: 'snapshot',
    terminalProjectionEffect: { kind: 'none' },
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    snapshot: '',
    snapshotSeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    canonicalSize: { cols: 100, rows: 30 },
    controller: { clientId: 'client_local', status: 'connected' },
    ...overrides,
    ok: true as const,
  }
  return result
}

function streamAttachResult(
  terminalRuntimeSessionId: string,
): Extract<TerminalAttachResult, { ok: true; frame: 'stream' }> {
  return {
    ok: true,
    frame: 'stream',
    terminalProjectionEffect: { kind: 'delta', revision: 1 },
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalSize: { cols: 100, rows: 30 },
  }
}

function restartResult(terminalRuntimeSessionId: string): Extract<TerminalRestartResult, { ok: true }> {
  return {
    ...streamAttachResult(terminalRuntimeSessionId),
    terminalRuntimeGeneration: 2,
    terminalProjectionEffect: { kind: 'delta', revision: 1 },
  }
}

function emitSessionOutput(session: TerminalSession, terminalRuntimeGeneration: number, data = 'prompt'): void {
  session.handleOutput({
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    terminalRuntimeGeneration,
    terminalSessionId: descriptor.terminalSessionId,
    data,
    seq: 1,
    processName: 'zsh',
  })
}

function takeoverResult(
  terminalRuntimeSessionId: string,
  overrides: Partial<Extract<TerminalTakeoverResult, { ok: true }>> = {},
): TerminalTakeoverResult {
  return {
    ok: true,
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 1,
    role: 'controller',
    controllerStatus: 'connected',
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalSize: { cols: 100, rows: 30 },
    phase: 'open',
    ...overrides,
  }
}

function hydrateManagedSession(
  session: TerminalSession,
  overrides: Partial<{
    terminalRuntimeSessionId: string
    terminalRuntimeGeneration: number
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    processName: string
    canonicalTitle?: string | null
    role: 'controller' | 'viewer' | 'unowned'
    controllerStatus: 'connected' | 'none'
    canonicalSize: { cols: number; rows: number } | null
  }> = {},
): void {
  session.hydrate({
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    terminalRuntimeGeneration: 0,
    phase: 'opening',
    message: null,
    processName: 'zsh',
    canonicalTitle: null,
    role: 'unowned',
    controllerStatus: 'none',
    canonicalSize: null,
    ...overrides,
  })
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
  // Drain xterm render frames and the session's normal debounced work.
  await vi.runAllTimersAsync()
}

async function flushResizeDispatch(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushMicrotasksUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('microtask condition was not met')
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
