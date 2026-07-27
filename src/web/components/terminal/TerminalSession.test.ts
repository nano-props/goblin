// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ILinkHandler } from '@xterm/xterm'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { flushMicrotasks, waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { terminalLog } from '#/web/logger.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-socket-connection.ts'
import { installTerminalThemeStyles } from '#/web/test-utils/terminal-theme.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'
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
    input = vi.fn((data: string, wasUserInput = true) => {
      if (wasUserInput) {
        if (this.options.scrollOnUserInput) this.scrollToBottom()
      }
      this.emitData(data)
    })
    reset = vi.fn()
    paste = vi.fn()
    scrollToBottom = vi.fn()
    dispose = vi.fn()
    focus = vi.fn(() => this.textarea?.focus())
    customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null
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
      for (const handler of this.keyHandlers) handler({ key: data, domEvent })
      this.emitData(data)
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
    private resultHandlers: Array<(event: { resultIndex: number; resultCount: number }) => void> = []
    clearDecorations = vi.fn()
    clearActiveDecoration = vi.fn()

    readonly options?: { highlightLimit?: number }
    constructor(options?: { highlightLimit?: number }) {
      this.options = options
      if (addonFailures.search) throw new Error('search addon failed')
      searchAddons.push(this)
    }

    activate(_term: MockTerminal) {}

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
    constructor() {
      if (addonFailures.unicode) throw new Error('unicode addon failed')
    }

    activate(_term: MockTerminal) {}
  }

  class MockWebLinksAddon {
    readonly handler?: (event: MouseEvent, uri: string) => void
    constructor(handler?: (event: MouseEvent, uri: string) => void) {
      this.handler = handler
      if (addonFailures.webLinks) throw new Error('web links addon failed')
      webLinkAddons.push(this)
    }

    activate(_term: MockTerminal) {}

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

  emit(): void {
    this.cb([], this)
  }
}

class MockFontFaceSet {
  private readonly loadingDoneHandlers = new Set<() => void>()
  private readonly handlerMap = new Map<EventListenerOrEventListenerObject, () => void>()
  private readyDeferred = Promise.withResolvers<void>()
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
    this.readyDeferred = Promise.withResolvers<void>()
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
let nextIdentityRevision = 0

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
  useFakeTimers()
  xtermMocks.terminals.length = 0
  nextIdentityRevision = 0
  xtermMocks.fitAddons.length = 0
  xtermMocks.searchAddons.length = 0
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
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => terminalRect(800, 400))
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
        identityRevision: ++nextIdentityRevision,
        role: 'controller',
        controllerStatus: 'connected',
        controller: { clientId: 'client_local', status: 'connected' },
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
    const host = createTerminalHost()
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
    expect(xtermMocks.terminals[0]!.options.cursorStyle).toBe('bar')
    expect(terminalCalls.restart).not.toHaveBeenCalled()
  })

  test('does not open xterm until authoritative hydration supplies an addressable binding', async () => {
    const host = createTerminalHost()
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
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
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(term.refresh).not.toHaveBeenCalled()

    attach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    await flushTerminalStart()

    expect(term.refresh).toHaveBeenCalledWith(0, 29)
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('never reveals a fitted xterm superseded while its final render is pending', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
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
    const firstAttach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(firstAttach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        identityRevision: 1,
        canonicalSize: { cols: 90, rows: 25 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    const fitAddon = xtermMocks.fitAddons[0]!
    firstAttach.resolve(attachResult('pty_session_1_aaaaaaaaa'))
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)

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

  test('fails a controller attach response that did not commit its requested geometry', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        canonicalSize: { cols: 99, rows: 29 },
      }),
    )
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals[0]!.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    expect(warnSpy).toHaveBeenCalledWith(
      'terminal presentation failed',
      expect.objectContaining({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        error: expect.objectContaining({
          message: 'terminal start response did not commit the requested controller geometry',
        }),
      }),
    )
    warnSpy.mockRestore()
  })

  test('keeps the fresh xterm intact and renders realtime output from sequence 1', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const host = createTerminalHost()
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

  test('rebuilds a visible terminal from the authoritative snapshot after an append render failure', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    const failedTerm = xtermMocks.terminals[0]!
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'authoritative screen after render failure',
        snapshotSeq: 1,
      }),
    )
    failedTerm.write.mockImplementationOnce(() => {
      throw new Error('xterm write buffer overflow')
    })

    emitSessionOutput(session, 1, 'live output that failed to render')
    await flushUntil(() => xtermMocks.terminals.length === 2)
    await flushTerminalStart()

    expect(failedTerm.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(xtermMocks.terminals[1]!.write).toHaveBeenCalledWith(
      'authoritative screen after render failure',
      expect.any(Function),
    )
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('transfers automatic focus when a fresh stream presentation is complete', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    const { host, session, term, settled } = await startPendingFocusRequest()
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('hidden')
    term.emitUserData('typed-before-render')
    await flushMicrotasks(2)
    expect(terminalCalls.write).not.toHaveBeenCalled()

    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.write).not.toHaveBeenCalled()
    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()

    emitSessionOutput(session, 1, 'prompt')
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('prompt', expect.any(Function))
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

  test('drops an automatic focus transfer whose presentation lease expires before presentation', async () => {
    terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
    let focusIsCurrent = true
    const { host, term, settled } = await startPendingFocusRequest(() => focusIsCurrent)
    await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)
    focusIsCurrent = false

    await flushTerminalStart()

    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('queues fresh output while hidden and flushes it in order after presentation', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()

    emitSessionOutput(session, 1, 'first output')
    emitSessionOutput(session, 1, ' then second output', 2)
    await Promise.resolve()

    expect(term.write).not.toHaveBeenCalled()
    expect(frame?.style.visibility).toBe('hidden')

    term.emitRender()
    await waitForMicrotaskCondition(() => term.write.mock.calls.length === 1)

    expect(frame?.style.visibility).toBe('')
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.write).toHaveBeenCalledWith('first output then second output', expect.any(Function))
    await flushTerminalStart()
    expect(term.write).toHaveBeenCalledTimes(1)
  })

  test('renders output that arrives after fresh stream presentation without another viewport refresh', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()

    expect(frame?.style.visibility).toBe('hidden')
    term.emitRender()
    await waitForMicrotaskCondition(() => frame?.style.visibility === '')

    emitSessionOutput(session, 1, 'later output')
    await flushTerminalStart()

    expect(frame?.style.visibility).toBe('')
    expect(term.write).toHaveBeenCalledWith('later output', expect.any(Function))
    expect(term.write).toHaveBeenCalledTimes(1)
    expect(term.refresh).toHaveBeenCalledTimes(1)
  })

  test('rebuilds from the authoritative snapshot when queued fresh output cannot render after presentation', async () => {
    const { host, session, term: failedTerm } = await startHiddenFreshStreamPresentation()
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'authoritative screen after pending render failure',
        snapshotSeq: 1,
      }),
    )
    failedTerm.write.mockImplementationOnce(() => {
      throw new Error('xterm write buffer overflow')
    })

    emitSessionOutput(session, 1, 'pending live output')
    failedTerm.emitRender()
    await flushUntil(() => xtermMocks.terminals.length === 2)
    await flushTerminalStart()

    expect(failedTerm.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(xtermMocks.terminals[1]!.write).toHaveBeenCalledWith(
      'authoritative screen after pending render failure',
      expect.any(Function),
    )
    expect(host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility).toBe('')
  })

  test('defers fresh-output protocol replies until the terminal is presented', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()
    term.write.mockImplementationOnce((_data: string, callback?: () => void) => {
      term.emitData('\x1b[1;1R')
      if (callback) queueMicrotask(callback)
    })

    emitSessionOutput(session, 1, '\x1b[6n')

    expect(frame?.style.visibility).toBe('hidden')
    expect(term.write).not.toHaveBeenCalled()
    expect(terminalCalls.write).not.toHaveBeenCalled()

    term.emitRender()
    await waitForMicrotaskCondition(() => terminalCalls.write.mock.calls.length === 1)

    expect(frame?.style.visibility).toBe('')
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1b[1;1R',
    })
  })

  test('discards an xterm protocol reply generated by snapshot replay', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    term.write.mockImplementationOnce((_data: string, callback?: () => void) => {
      term.emitData('\x1b[1;1R')
      if (callback) queueMicrotask(callback)
    })
    attach.resolve(attachResult('pty_session_1_aaaaaaaaa', { snapshot: '\x1b[6n', snapshotSeq: 1 }))

    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('\x1b[6n', expect.any(Function))
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('ignores stale-generation output without delaying fresh stream presentation', async () => {
    const { session, term, frame } = await startHiddenFreshStreamPresentation()
    emitSessionOutput(session, 0, 'stale prompt')
    await Promise.resolve()

    expect(term.write).not.toHaveBeenCalled()
    expect(frame?.style.visibility).toBe('hidden')

    term.emitRender()
    await waitForMicrotaskCondition(() => frame?.style.visibility === '')

    expect(term.write).not.toHaveBeenCalled()
    emitSessionOutput(session, 1, 'current prompt')
    await flushTerminalStart()

    expect(term.write).toHaveBeenCalledWith('current prompt', expect.any(Function))
    expect(frame?.style.visibility).toBe('')
  })

  test('cancels a fresh stream presentation that detaches before its viewport render', async () => {
    const { host, session, term, frame } = await startHiddenFreshStreamPresentation()
    expect(frame?.style.visibility).toBe('hidden')
    session.detach(host)
    await flushTerminalStart()

    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.write).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('keeps a prepared server session opening while the local xterm attach is pending', async () => {
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    vi.mocked(HTMLElement.prototype.getBoundingClientRect)
      .mockReturnValueOnce(terminalRect(800, 400))
      .mockReturnValue(terminalRect(0, 0))
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()

    expect(terminalCalls.attach).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
  })

  test('fences resize and restart requests to the retiring generation', async () => {
    const host = createTerminalHost()
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
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
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

  test('disposes the observer and aborts xterm creation during font preload', async () => {
    const preload = Promise.withResolvers<void>()
    geometryMocks.preloadTerminalFont.mockReturnValueOnce(preload.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    const observer = MockResizeObserver.instances[0]
    if (!observer) throw new Error('expected resize observer')

    session.dispose()
    preload.resolve()
    await flushTerminalStart()

    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(xtermMocks.terminals).toHaveLength(0)
  })

  test('does not dispatch attach after the view detaches during font preload', async () => {
    const preload = Promise.withResolvers<void>()
    geometryMocks.preloadTerminalFont.mockReturnValueOnce(preload.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await waitForMicrotaskCondition(() => geometryMocks.preloadTerminalFont.mock.calls.length === 1)
    session.detach(host)
    preload.resolve()
    await flushTerminalStart()

    expect(terminalCalls.attach).not.toHaveBeenCalled()
    expect(terminalCalls.restart).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(0)
    expect(host.querySelector('.goblin-managed-terminal-frame')).toBeNull()
  })

  test('remeasures without refreshing or scrolling after fonts finish loading', async () => {
    const { term } = await startOpenControllerSession()
    const fitAddon = xtermMocks.fitAddons[0]!
    term.refresh.mockClear()
    term.scrollToBottom.mockClear()
    fitAddon.proposeDimensions.mockClear()

    mockFonts.resolveReady()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.refresh).not.toHaveBeenCalled()
    expect(term.scrollToBottom).not.toHaveBeenCalled()

    fitAddon.proposeDimensions.mockClear()

    mockFonts.emitLoadingDone()
    await flushFontRefit()

    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(term.refresh).not.toHaveBeenCalled()
    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  test('does not resize or scroll the discarded xterm when attach resolves as viewer', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const term = xtermMocks.terminals[0]!
    expect(term.dispose).toHaveBeenCalledOnce()
    expect(term.scrollToBottom).not.toHaveBeenCalled()
  })

  test('activates Unicode 11 and exposes terminal search', async () => {
    const { session, term } = await startOpenControllerSession()

    expect(term.unicode.activeVersion).toBe('11')
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
      const { term } = await startOpenControllerSession()
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
      const { term } = await startOpenControllerSession()
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

  test('routes WebLinks and OSC 8 hyperlinks through the safe shell bridge', async () => {
    const { term } = await startOpenControllerSession()
    xtermMocks.webLinkAddons[0]!.open('https://example.com/path')
    const event = new MouseEvent('click', { cancelable: true })
    term.options.linkHandler!.activate(event, 'https://example.com/osc8', {
      start: { x: 1, y: 1 },
      end: { x: 10, y: 1 },
    })
    await Promise.resolve()

    expect(event.defaultPrevented).toBe(true)
    expect(term.options.linkHandler!.allowNonHttpProtocols).toBe(false)
    expect(hostOpenExternalUrl).toHaveBeenNthCalledWith(1, { url: 'https://example.com/path', allowHttp: true })
    expect(hostOpenExternalUrl).toHaveBeenNthCalledWith(2, { url: 'https://example.com/osc8', allowHttp: true })
  })

  test('does not send unsafe web links to the app ipc', async () => {
    await startOpenControllerSession()
    xtermMocks.webLinkAddons[0]!.open('javascript:alert(1)')
    xtermMocks.webLinkAddons[0]!.open('file:///tmp/secret')
    xtermMocks.webLinkAddons[0]!.open('https://example.com/\u0000bad')
    await Promise.resolve()

    expect(hostOpenExternalUrl).not.toHaveBeenCalled()
  })

  test('keeps the terminal usable when every optional addon fails', async () => {
    Object.assign(xtermMocks.addonFailures, {
      search: true,
      unicode: true,
      webLinks: true,
      image: true,
      progress: true,
    })
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const { session } = await startOpenControllerSession()

    expect(session.snapshot().phase).toBe('open')
    expect(session.findNext('needle')).toEqual({ resultIndex: -1, resultCount: 0, found: false })
    expect(warnSpy).toHaveBeenCalledWith('failed to load unicode11 addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load web links addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load search addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load image addon', { err: expect.any(Error) })
    expect(warnSpy).toHaveBeenCalledWith('failed to load progress addon', { err: expect.any(Error) })
    warnSpy.mockRestore()
  })

  test('uses first-class restart IPC instead of recreating through ensureSession', async () => {
    const host = createTerminalHost()
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
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
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
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    terminalCalls.restart.mockClear()

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(0, 0))
    session.restart()
    await flushTerminalStart()
    expect(terminalCalls.restart).not.toHaveBeenCalled()

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(800, 400))
    const resizeObserver = MockResizeObserver.instances[0]
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.emit()
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await waitForMicrotaskCondition(() => xtermMocks.terminals[0]?.write.mock.calls.length === 1)

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
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushTerminalStart()
    expect(session.snapshot().phase).toBe('error')
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    MockResizeObserver.instances[0]!.emit()
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
    expect(session.snapshot().phase).toBe('error')
  })

  test('does not turn a local attach transport failure into authoritative runtime error metadata', async () => {
    terminalCalls.attach.mockRejectedValueOnce(new Error('transport unavailable'))
    const warnSpy = vi.spyOn(terminalLog, 'warn').mockImplementation(() => {})
    const host = createTerminalHost()
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.attach(host)
    expect(session.focus({ isCurrent: () => true, onSettled: settled })).toBe(true)
    await flushTerminalStart()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals[0]!.focus).not.toHaveBeenCalled()
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
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
    expect(xtermMocks.terminals.at(-1)!.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
    expect(host.contains(document.activeElement)).toBe(true)
  })

  test('does not retain an unscoped focus request while presentation is pending', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    expect(session.focus()).toBe(false)
    await flushTerminalStart()

    expect(xtermMocks.terminals[0]!.focus).not.toHaveBeenCalled()
  })

  test('rebuilds a connected view as one focus and transient-state transaction', async () => {
    const { session, notify, term: firstTerm } = await startSessionWithProgress()
    session.focus()
    expect(terminalHasKeyboardFocus()).toBe(true)
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.resynchronizeConnectedView()

    expect(firstTerm.dispose).toHaveBeenCalledOnce()
    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledWith('metadata')
    await flushTerminalStart()

    const rebuiltTerm = xtermMocks.terminals.at(-1)!
    expect(rebuiltTerm).not.toBe(firstTerm)
    expect(rebuiltTerm.focus).toHaveBeenCalledOnce()
    expect(terminalHasKeyboardFocus()).toBe(true)
  })

  test('clears and publishes transient state for a connected viewer during resynchronization', async () => {
    const { host, session, notify } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBeNull()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.resynchronizeConnectedView()

    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledWith('metadata')
    expect(terminalCalls.attach).toHaveBeenCalledOnce()
  })

  test.each([
    [
      'transport failure',
      () => {
        const error = new Error('write failed')
        terminalCalls.write.mockRejectedValueOnce(error)
        return { kind: 'error' as const, error }
      },
    ],
    [
      'server rejection',
      () => {
        const result = { status: 'rejected' as const }
        terminalCalls.write.mockResolvedValueOnce(result)
        return { kind: 'result' as const, result }
      },
    ],
  ] as const)('reports a terminal write %s without closing the session', async (_failureKind, configureWrite) => {
    const failure = configureWrite()
    const report = vi.fn()
    const session = new TerminalSession(descriptor, vi.fn(), { report })
    const { term } = await startOpenControllerSession(session)

    term.emitData('input')
    await flushTerminalStart()

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: 'input',
    })
    expect(report).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      failure,
    })
    expect(session.snapshot().phase).toBe('open')
  })

  test('batches rapid user input into a single ordered write', async () => {
    const { term } = await startOpenControllerSession()
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
    const { session, term } = await startOpenControllerSession()

    term.emitData('x')
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
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: failure === 'canonical size mismatch' ? { cols: 102, rows: 32 } : { cols: 101, rows: 31 },
      })
    }
    const { session, term: invalidatedTerm } = await startOpenControllerSession()
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        snapshot: 'recovered after resize',
        snapshotSeq: 1,
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )

    invalidatedTerm.resize(101, 31)
    await flushMicrotasks(2)
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
    const firstResize = Promise.withResolvers<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(firstResize.promise)
    const { term } = await startOpenControllerSession()

    term.resize(101, 31)
    await waitForMicrotaskCondition(() => terminalCalls.resize.mock.calls.length === 1)
    term.resize(102, 32)
    term.resize(103, 33)
    await flushMicrotasks(2)
    expect(terminalCalls.resize).toHaveBeenCalledOnce()

    firstResize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_local', status: 'connected' },
      canonicalSize: { cols: 101, rows: 31 },
    })
    nextIdentityRevision = 1
    await waitForMicrotaskCondition(() => terminalCalls.resize.mock.calls.length === 2)

    expect(terminalCalls.resize).toHaveBeenNthCalledWith(2, {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 103,
      rows: 33,
    })
    await flushTerminalStart()
    expect(terminalCalls.resize).toHaveBeenCalledTimes(2)
  })

  test('does not let a stale resize acknowledgement regress newer controller geometry', async () => {
    const resize = Promise.withResolvers<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(resize.promise)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)

    term.resize(101, 31)
    await flushUntil(() => terminalCalls.resize.mock.calls.length === 1)
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    notify.mockClear()
    resize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_local', status: 'connected' },
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

  test('ignores a stale resize acknowledgement without rebuilding the current controller view', async () => {
    const resize = Promise.withResolvers<TerminalResizeResult>()
    terminalCalls.resize.mockReturnValueOnce(resize.promise)
    const notify = vi.fn()
    const session = new TerminalSession(descriptor, notify)
    const { term } = await startOpenControllerSession(session)

    term.resize(101, 31)
    await flushUntil(() => terminalCalls.resize.mock.calls.length === 1)
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    resize.resolve({
      ok: true,
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_local', status: 'connected' },
      canonicalSize: { cols: 101, rows: 31 },
    })
    await flushTerminalStart()

    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(term.dispose).not.toHaveBeenCalled()
    expect(xtermMocks.terminals).toHaveLength(1)
  })

  test('does not send resize or input while attached as a mirror page before explicit takeover', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_remote', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushMicrotasks(2)
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
        identityRevision: 1,
        snapshot: 'hydrated-screen',
        snapshotSeq: 5,
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!

    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
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
    const host = createTerminalHost()
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
        identityRevision: 1,
        processName: 'node',
        snapshot: 'remote-screen',
        snapshotSeq: 5,
      }),
    )

    session.hydrate({
      terminalRuntimeSessionId: 'term-remoteremoteremote001',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    const term = xtermMocks.terminals[0]!
    term.write.mockClear()

    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
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
    const host = createTerminalHost()
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
    const { session } = await startPresentedControllerGeneration()

    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')
    expect(inputWriter("bat '/worktree/file.ts'\r")).toBe(true)
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledTimes(1)
    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: "bat '/worktree/file.ts'\r",
    })
  })

  test('encodes virtual keys at the current xterm input boundary', async () => {
    const { session, term } = await startPresentedControllerGeneration()

    term.scrollToBottom.mockClear()
    session.sendVirtualKey('arrow-up')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
    expect(term.input).toHaveBeenLastCalledWith('\x1b[A', true)
    expect(term.scrollToBottom).toHaveBeenCalledOnce()
    expect(terminalCalls.write).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1b[A',
    })

    terminalCalls.write.mockClear()
    term.modes.applicationCursorKeysMode = true
    term.options.scrollOnUserInput = false
    term.scrollToBottom.mockClear()
    session.sendVirtualKey('arrow-right')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
    expect(term.input).toHaveBeenLastCalledWith('\x1bOC', true)
    expect(term.scrollToBottom).not.toHaveBeenCalled()
    expect(terminalCalls.write).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x1bOC',
    })

    terminalCalls.write.mockClear()
    term.options.scrollOnUserInput = true
    session.sendVirtualKey('interrupt')
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)
    expect(terminalCalls.write).toHaveBeenLastCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: '\x03',
    })
  })

  test('captures xterm paste for the active presented controller and rejects it after restart', async () => {
    const { host, session, term } = await startPresentedControllerGeneration()

    const pasteWriter = session.capturePasteWriter()
    if (!pasteWriter) throw new Error('expected presented paste writer')
    expect(pasteWriter('first line\nsecond line')).toBe(true)
    expect(term.paste).toHaveBeenCalledWith('first line\nsecond line')

    session.restart()
    await flushUntil(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 2)
    emitSessionOutput(session, 2)
    await flushUntil(() => host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')?.style.visibility === '')

    expect(pasteWriter('from old generation')).toBe(false)
    expect(term.paste).toHaveBeenCalledTimes(1)
    expect(xtermMocks.terminals.at(-1)!.paste).not.toHaveBeenCalled()
  })

  test('commits asynchronous input only to the generation captured by its writer', async () => {
    const { session } = await startPresentedControllerGeneration()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.restart()

    expect(inputWriter("'/tmp/from-old-generation'")).toBe(false)
    await flushTerminalStart()
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('rejects a captured input writer after controller authority is lost', async () => {
    const { session } = await startPresentedControllerGeneration()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })

    expect(inputWriter("'/tmp/after-takeover'")).toBe(false)
    await Promise.resolve()
    expect(terminalCalls.write).not.toHaveBeenCalled()
  })

  test('keeps a captured input writer bound to the same runtime generation across presentation rebuilds', async () => {
    const { host, session } = await startPresentedControllerGeneration()
    const inputWriter = session.captureInputWriter()
    if (!inputWriter) throw new Error('expected presented input writer')

    session.detach(host)
    session.attach(host)
    await flushTerminalStart()
    expect(inputWriter("'/tmp/from-old-presentation'")).toBe(true)
    await flushUntil(() => terminalCalls.write.mock.calls.length > 0)

    expect(terminalCalls.write).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      data: "'/tmp/from-old-presentation'",
    })
  })

  test('tracks server title changes separately from process name', async () => {
    const host = createTerminalHost()
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

  test('joins concurrent takeover callers to one server mutation', async () => {
    const takeoverResponse = Promise.withResolvers<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    const host = createTerminalHost()
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

  test('ignores a takeover response superseded by a newer identity revision', async () => {
    const takeoverResponse = Promise.withResolvers<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session, {
      terminalRuntimeGeneration: 1,
      phase: 'open',
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    session.attach(host)

    const takeover = session.takeover()
    await flushUntil(() => terminalCalls.takeover.mock.calls.length === 1)
    const candidateTerm = xtermMocks.terminals[0]!
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'viewer',
      controllerStatus: 'connected',
      canonicalSize: { cols: 120, rows: 40 },
    })
    takeoverResponse.resolve(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        identityRevision: 1,
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )

    await expect(takeover).resolves.toBe(false)
    expect(session.snapshot().attachment).toEqual({ role: 'viewer' })
    expect(candidateTerm.dispose).toHaveBeenCalledOnce()
    expect(terminalCalls.attach).not.toHaveBeenCalled()
  })

  test('reports a committed takeover as successful when its recovery presentation fails', async () => {
    terminalCalls.takeover.mockResolvedValueOnce(takeoverResult('pty_session_1_aaaaaaaaa'))
    terminalCalls.attach.mockResolvedValueOnce({ ok: false, message: 'recovery unavailable' })
    const host = createTerminalHost()
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
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 101, rows: 31 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    xtermMocks.terminals[0]!.resize(101, 31)
    await flushMicrotasks(2)
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
      identityRevision: 2,
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
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
        snapshot: 'post-takeover-screen',
        snapshotSeq: 8,
      }),
    )
    const host = createTerminalHost()
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
    const takeoverResponse = Promise.withResolvers<TerminalTakeoverResult>()
    terminalCalls.takeover.mockReturnValueOnce(takeoverResponse.promise)
    terminalCalls.attach.mockResolvedValueOnce(
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
        terminalRuntimeGeneration: 1,
        snapshot: 'post-takeover recovery',
      }),
    )
    const host = createTerminalHost()
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
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
      }),
    )
    const host = createTerminalHost()
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

  test.each([
    [
      'snapshot hydration',
      (session: TerminalSession) =>
        session.hydrate({
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          identityRevision: 1,
          phase: 'open',
          message: null,
          processName: 'zsh',
          canonicalTitle: null,
          role: 'unowned',
          controllerStatus: 'none',
          canonicalSize: { cols: 120, rows: 40 },
        }),
    ],
    [
      'realtime identity',
      (session: TerminalSession) =>
        session.handleIdentity({
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          identityRevision: 1,
          role: 'unowned',
          controllerStatus: 'none',
          canonicalSize: { cols: 120, rows: 40 },
        }),
    ],
  ] as const)('mounted viewer auto-attaches when %s reports unowned authority', async (_source, applyUnowned) => {
    terminalCalls.attach.mockResolvedValueOnce(
      recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 100, rows: 30 },
        snapshot: 'reclaimed-screen',
        snapshotSeq: 10,
      }),
    )
    const host = createTerminalHost()
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
    expect(terminalCalls.attach).not.toHaveBeenCalled()

    applyUnowned(session)
    await flushTerminalStart()

    expect(terminalCalls.attach).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(session.snapshot().attachment).toEqual({ role: 'controller' })
    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('reclaimed-screen', expect.any(Function))
  })

  test('commits fitted geometry in the first post-takeover recovery attach', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: { clientId: 'client_local', status: 'connected' },
        canonicalSize: { cols: 132, rows: 43 },
      }),
    )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    const takeover = session.takeover()
    await flushTerminalStart()
    await expect(takeover).resolves.toBe(true)

    expect(terminalCalls.attach).toHaveBeenCalledTimes(2)
    expect(terminalCalls.attach).toHaveBeenNthCalledWith(2, {
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
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
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
    const host = createTerminalHost()
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

  test('applies a newer realtime identity after takeover commits', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 1, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    terminalCalls.takeover.mockResolvedValueOnce(
      takeoverResult('pty_session_1_aaaaaaaaa', {
        controller: null,
      }),
    )
    const host = createTerminalHost()
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
      identityRevision: 2,
      role: 'unowned',
      controllerStatus: 'none',
      canonicalSize: { cols: 120, rows: 40 },
    })

    expect(session.snapshot().phase).toBe('open')
    expect(session.snapshot().attachment).toMatchObject({ role: 'unowned' })
  })

  test('starts a generation-fenced recovery attach when identity grants local control', async () => {
    terminalCalls.attach
      .mockResolvedValueOnce(
        attachResult('pty_session_1_aaaaaaaaa', {
          controller: { clientId: 'client_remote', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        }),
      )
      .mockResolvedValueOnce(
        recoveryAttachResult('pty_session_1_aaaaaaaaa', 2, {
          controller: { clientId: 'client_local', status: 'connected' },
          canonicalSize: { cols: 100, rows: 30 },
        }),
      )
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
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

  test('resets the terminal before replaying the snapshot', async () => {
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', { snapshot: 'tail', snapshotSeq: 1 }),
    )
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
        tabsBeforeRetirement: null,
      }),
    ).toBe(false)
    expect(
      session.handleExit({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: requiredWorkspaceLocator('/repo'),
        workspaceRuntimeId: 'repo-runtime-1',
        tabsBeforeRetirement: null,
      }),
    ).toBe(true)
    session.dispose()

    expect(xtermMocks.terminals[0]!.write).toHaveBeenCalledWith('before exit', expect.any(Function))
    expect(session.snapshot()).toMatchObject({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null })
    expect(terminalCalls.close).not.toHaveBeenCalled()
  })

  test('keeps hydrated title when selecting a mirrored session', async () => {
    const host = createTerminalHost()
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
    const host = createTerminalHost()
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
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
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
    const restart = Promise.withResolvers<TerminalRestartResult>()
    terminalCalls.restart.mockReturnValueOnce(restart.promise)
    const host = createTerminalHost()
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
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'recovered generation 1',
      }),
    )
    const host = createTerminalHost()
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
    const oldAttach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(oldAttach.promise).mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 2,
        snapshot: 'generation 2 recovery',
      }),
    )
    const host = createTerminalHost()
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
      identityRevision: 0,
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
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)

    session.attach(host)
    await flushUntil(() => terminalCalls.attach.mock.calls.length === 1)
    const firstTerm = xtermMocks.terminals[0]!
    const firstFit = xtermMocks.fitAddons[0]!
    attach.resolve(streamAttachResult('pty_session_1_aaaaaaaaa'))
    await waitForMicrotaskCondition(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
    await waitForMicrotaskCondition(() => firstTerm.refresh.mock.calls.length === 1)
    firstFit.proposeDimensions.mockReturnValue(null)
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(0, 0))
    await flushTerminalStart()

    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
    })
    expect(firstTerm.dispose).toHaveBeenCalledOnce()
    expect(host.querySelector('.goblin-managed-terminal-frame .xterm')).toBeNull()
    expect(terminalCalls.attach).toHaveBeenCalledTimes(1)

    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(terminalRect(800, 400))
    terminalCalls.attach.mockResolvedValueOnce(
      attachResult('pty_session_1_aaaaaaaaa', {
        terminalRuntimeGeneration: 1,
        snapshot: 'recovered committed binding',
      }),
    )
    const resizeObserver = MockResizeObserver.instances.at(-1)
    if (!resizeObserver) throw new Error('expected resize observer')
    resizeObserver.emit()
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

  test('destroys the detached xterm and opens a fresh view on reattach', async () => {
    const host = createTerminalHost()
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
    expect(xtermMocks.terminals).toHaveLength(2)
    expect(host.querySelector('.goblin-managed-terminal-frame')).not.toBeNull()
  })

  test('focus checks are derived from the xterm DOM host', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    xtermMocks.terminals[0]!.focus()
    expect(terminalHasKeyboardFocus()).toBe(true)
  })

  test('keeps disconnected focus pending and accepts its retry after the view attaches', async () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    const request = { isCurrent: () => true, onSettled: settled }

    expect(session.focus(request)).toBe(false)
    expect(settled).not.toHaveBeenCalled()
    session.attach(host)
    expect(session.focus(request)).toBe(true)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!

    expect(term.focus).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    await flushTerminalStart()

    expect(term.focus).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  })

  test('settles a focus lease when its initial currency check throws', () => {
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()
    session.attach(host)

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
    const { term, settled } = await startPendingFocusRequest()
    term.focus.mockImplementationOnce(() => {
      throw new Error('focus failed')
    })
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.dispose).toHaveBeenCalledOnce()
  })

  test('releases a pending focus lease when the hidden presentation detaches', async () => {
    const { host, session, term, settled } = await startPendingFocusRequest()
    session.detach(host)
    await flushTerminalStart()

    expect(settled).toHaveBeenCalledOnce()
    expect(term.focus).not.toHaveBeenCalled()
  })

  test('releases a pending focus lease when controller ownership changes to viewer', async () => {
    const { session, term, settled } = await startPendingFocusRequest()
    session.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
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
    const attach = Promise.withResolvers<TerminalAttachResult>()
    terminalCalls.attach.mockReturnValueOnce(attach.promise)
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    const settled = vi.fn()

    session.attach(host)
    expect(session.focus({ isCurrent: () => true, onSettled: settled })).toBe(true)
    await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
    const term = xtermMocks.terminals[0]!
    session.hydrate({
      terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
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
    const host = createTerminalHost()
    const session = new TerminalSession(descriptor, vi.fn())
    hydrateManagedSession(session)
    session.attach(host)
    await flushTerminalStart()

    const term = xtermMocks.terminals[0]!
    const frame = host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')
    expect(term.options.theme).toMatchObject({ background: '#ffffff', foreground: '#1d1d1f' })
    expect(frame?.style.background).toBe('rgb(255, 255, 255)')
    expect(frame?.style.getPropertyValue('--goblin-terminal-background')).toBe('#ffffff')

    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve()

    expect(term.options.theme).toMatchObject({ background: '#111113', foreground: '#f5f5f7' })
    expect(frame?.style.getPropertyValue('--goblin-terminal-background')).toBe('#111113')
  })

  test('progress state appears in snapshot and clears on state 0', async () => {
    const { session, notify, progressAddon } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    expect(notify).toHaveBeenCalledTimes(1)

    progressAddon.emitProgress(0, 0)
    expect(session.snapshot().progress).toBeUndefined()
  })

  test('progress state is cleared on restart', async () => {
    const { session } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })

    session.restart()
    await flushTerminalStart()
    await flushUntil(() => session.snapshot().phase === 'open')

    expect(session.snapshot().progress).toBeUndefined()
  })

  test('progress state is cleared and published on detach', async () => {
    const { host, session, notify } = await startSessionWithProgress()
    expect(session.snapshot().progress).toEqual({ state: 1, value: 75 })
    notify.mockClear()

    session.detach(host)

    expect(session.snapshot().progress).toBeUndefined()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  describe('identity and lifecycle presentation contract', () => {
    test('realtime lifecycle update overrides a prior takeover response phase', async () => {
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
      const host = createTerminalHost()
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const takeover = session.takeover()
      await flushTerminalStart()
      await expect(takeover).resolves.toBe(true)
      expect(session.snapshot().phase).toBe('open')

      session.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'restarting',
        message: null,
      })
      expect(session.snapshot().phase).toBe('restarting')
    })

    test('preserves the controller xterm across identity and transitional lifecycle updates', async () => {
      const host = createTerminalHost()
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      const xtermBefore = host.querySelector('.goblin-managed-terminal-host .xterm')
      expect(xtermBefore).not.toBeNull()
      expect(session.snapshot().attachment).toMatchObject({ role: 'controller' })

      session.handleIdentity({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        canonicalSize: { cols: 100, rows: 30 },
      })

      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBe(xtermBefore)

      session.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        phase: 'opening',
        message: null,
      })
      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).toBe(xtermBefore)
      expect(session.snapshot().phase).toBe('opening')
    })

    test('realtime viewer identity tears down the controller xterm', async () => {
      const host = createTerminalHost()
      const session = new TerminalSession(descriptor, vi.fn())
      hydrateManagedSession(session)
      session.attach(host)
      await flushTerminalStart()
      await flushUntil(() => session.snapshot().phase === 'open')

      expect(host.querySelector('.goblin-managed-terminal-host .xterm')).not.toBeNull()

      session.handleIdentity({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
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
    identityRevision: 0,
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

function recoveryAttachResult(
  terminalRuntimeSessionId: string,
  identityRevision: number,
  overrides: Parameters<typeof attachResult>[1] = {},
): Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> {
  return attachResult(terminalRuntimeSessionId, { ...overrides, identityRevision })
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
    identityRevision: 0,
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

function emitSessionOutput(
  session: TerminalSession,
  terminalRuntimeGeneration: number,
  data = 'prompt',
  seq = 1,
): void {
  session.handleOutput({
    terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
    terminalRuntimeGeneration,
    terminalSessionId: descriptor.terminalSessionId,
    data,
    seq,
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
    identityRevision: 1,
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
    identityRevision: number
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
    identityRevision: 0,
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

function createTerminalHost(): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

async function startOpenControllerSession(session: TerminalSession = new TerminalSession(descriptor, vi.fn())) {
  const host = createTerminalHost()
  hydrateManagedSession(session)
  session.attach(host)
  await flushTerminalStart()
  await flushUntil(() => session.snapshot().phase === 'open')
  return { host, session, term: xtermMocks.terminals[0]! }
}

async function startPresentedControllerGeneration() {
  const host = createTerminalHost()
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
  return { host, session, term: xtermMocks.terminals[0]! }
}

async function startHiddenFreshStreamPresentation() {
  terminalCalls.attach.mockResolvedValueOnce(streamAttachResult('pty_session_1_aaaaaaaaa'))
  const host = createTerminalHost()
  const session = new TerminalSession(descriptor, vi.fn())
  hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })
  session.attach(host)
  await waitForMicrotaskCondition(() => session.currentRuntimeBinding()?.terminalRuntimeGeneration === 1)
  const term = xtermMocks.terminals[0]!
  const frame = host.querySelector<HTMLElement>('.goblin-managed-terminal-frame')
  await waitForMicrotaskCondition(() => term.refresh.mock.calls.length === 1)
  return { host, session, term, frame }
}

async function startPendingFocusRequest(isCurrent: () => boolean = () => true) {
  const host = createTerminalHost()
  const session = new TerminalSession(descriptor, vi.fn())
  hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })
  const settled = vi.fn()
  session.attach(host)
  if (!session.focus({ isCurrent, onSettled: settled })) throw new Error('expected accepted focus request')
  await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
  return { host, session, term: xtermMocks.terminals[0]!, settled }
}

async function startSessionWithProgress() {
  const notify = vi.fn()
  const host = createTerminalHost()
  const session = new TerminalSession(descriptor, notify)
  hydrateManagedSession(session)
  session.attach(host)
  await flushTerminalStart()
  await flushUntil(() => session.snapshot().phase === 'open')
  notify.mockClear()
  const progressAddon = xtermMocks.progressAddons[0]!
  progressAddon.emitProgress(1, 75)
  return { host, session, notify, term: xtermMocks.terminals[0]!, progressAddon }
}

function terminalRect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function optionArrow(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, altKey: true, cancelable: true })
}

async function flushTerminalStart(): Promise<void> {
  // Drain xterm render frames and the session's normal debounced work.
  await vi.runAllTimersAsync()
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
