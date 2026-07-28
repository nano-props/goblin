import type { ILinkHandler } from '@xterm/xterm'
import { vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION, ELECTRON_CLIENT_CAPABILITIES } from '#/shared/bootstrap.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalResizeInput,
  TerminalResizeResult,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalSessionInput,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
  TerminalWriteResult,
} from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator, formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { keyboardEventForTest } from '#/web/test-utils/keyboard-event.ts'
import { installTerminalThemeStyles } from '#/web/test-utils/terminal-theme.ts'

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
      const domEvent = keyboardEventForTest('keydown')
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
export function terminalXtermMocks() {
  return xtermMocks
}

export function terminalGeometryMocks() {
  return geometryMocks
}

export class MockResizeObserver {
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

export const terminalCalls = {
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
export const hostOpenExternalUrl = vi.fn<NonNullable<Window['goblinNative']['host']>['openExternalUrl']>()
export const mockFonts = new MockFontFaceSet()
let nextIdentityRevision = 0

export function setNextTerminalIdentityRevision(value: number): void {
  nextIdentityRevision = value
}

export function requiredWorkspaceLocator(input: string) {
  const locator =
    canonicalWorkspaceLocator(input) ??
    formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: input }, 'posix')
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

export const descriptor: TerminalDescriptor = {
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

export function resetTerminalSessionHarness() {
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
}
export function attachResult(
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

export function recoveryAttachResult(
  terminalRuntimeSessionId: string,
  identityRevision: number,
  overrides: Parameters<typeof attachResult>[1] = {},
): Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> {
  return attachResult(terminalRuntimeSessionId, { ...overrides, identityRevision })
}

export function streamAttachResult(
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

export function restartResult(terminalRuntimeSessionId: string): Extract<TerminalRestartResult, { ok: true }> {
  return {
    ...streamAttachResult(terminalRuntimeSessionId),
    terminalRuntimeGeneration: 2,
    terminalProjectionEffect: { kind: 'delta', revision: 1 },
  }
}

export function emitSessionOutput(
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

export function takeoverResult(
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

export function hydrateManagedSession(
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

export function createTerminalHost(): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

export async function startOpenControllerSession(session: TerminalSession = new TerminalSession(descriptor, vi.fn())) {
  const host = createTerminalHost()
  hydrateManagedSession(session)
  session.attach(host)
  await flushTerminalStart()
  await flushUntil(() => session.snapshot().phase === 'open')
  return { host, session, term: xtermMocks.terminals[0]! }
}

export async function startPresentedControllerGeneration() {
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

export async function startHiddenFreshStreamPresentation() {
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

export async function startPendingFocusRequest(isCurrent: () => boolean = () => true) {
  const host = createTerminalHost()
  const session = new TerminalSession(descriptor, vi.fn())
  hydrateManagedSession(session, { phase: 'opening', terminalRuntimeGeneration: 0 })
  const settled = vi.fn()
  session.attach(host)
  if (!session.focus({ isCurrent, onSettled: settled })) throw new Error('expected accepted focus request')
  await waitForMicrotaskCondition(() => terminalCalls.attach.mock.calls.length === 1)
  return { host, session, term: xtermMocks.terminals[0]!, settled }
}

export async function startSessionWithProgress() {
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

export function terminalRect(width: number, height: number): DOMRect {
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

export function optionArrow(key: string): KeyboardEvent {
  return keyboardEventForTest('keydown', { key, altKey: true, cancelable: true })
}

export async function flushTerminalStart(): Promise<void> {
  // Drain xterm render frames and the session's normal debounced work.
  await vi.runAllTimersAsync()
}

export async function flushFontRefit(): Promise<void> {
  // FONT_REMEASURE_DEBOUNCE_MS in the source is 80. Advance past it.
  await vi.advanceTimersByTimeAsync(100)
}

export async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await vi.runAllTimersAsync()
  }
  throw new Error('condition was not met')
}
