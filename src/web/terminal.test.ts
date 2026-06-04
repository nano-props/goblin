// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []
  readonly url: string
  readyState = MockWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: any) => void>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: any) => void) {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(cb)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', {})
  }

  emitMessage(data: unknown) {
    this.emit('message', { data })
  }

  private emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const mockNotifications: Array<{ onclick: (() => void) | null }> = []

class MockNotification {
  static permission: NotificationPermission = 'granted'
  static async requestPermission(): Promise<NotificationPermission> {
    return 'granted'
  }

  onclick: (() => void) | null = null

  constructor(_title: string, _options?: NotificationOptions) {
    mockNotifications.push(this)
  }

  close() {}
}

describe('terminal web host bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    setRendererBridgeForTests(null)
    MockWebSocket.instances.length = 0
    mockNotifications.length = 0
    window.localStorage.clear()
    window.sessionStorage.clear()
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket })
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: MockNotification })
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
        homeDir: '',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      },
    })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    })
  })

  test('opens terminals through embedded server routes in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: 'term_1234567890123456',
        replay: '',
        replaySeq: 0,
        replayTruncated: false,
        processName: 'zsh',
        title: null,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')

    const dispose = terminalBridge.onOutput(() => {})
    await expect(
      terminalBridge.attach({
        sessionId: 'term_1234567890123456',
        cols: 100,
        rows: 30,
      }),
    ).resolves.toMatchObject({ ok: true, processName: 'zsh' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/terminal/attach',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        }),
      }),
    )
    const firstCall = fetchMock.mock.calls.at(0) as [string, RequestInit] | undefined
    const requestBody = JSON.parse(String(firstCall?.[1]?.body))
    expect(requestBody).toMatchObject({
      clientId: 'client_sharedterminal',
      attachmentId: expect.stringMatching(/^attachment_/),
      sessionId: 'term_1234567890123456',
      cols: 100,
      rows: 30,
    })
    expect(MockWebSocket.instances[0]?.url).toMatch(
      /^ws:\/\/127\.0\.0\.1:32100\/ws\/terminal\?token=secret&clientId=client_sharedterminal&attachmentId=attachment_/,
    )
    dispose()
  })

  test('prefers the bootstrap-provided shared terminal client id over localStorage state', async () => {
    window.localStorage.setItem('goblin:web-terminal-client-id', 'web_oldpersistedclient')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: 'term_1234567890123456',
        replay: '',
        replaySeq: 0,
        replayTruncated: false,
        processName: 'zsh',
        title: null,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')

    await terminalBridge.attach({
      sessionId: 'term_1234567890123456',
      cols: 100,
      rows: 30,
    })

    const firstCall = fetchMock.mock.calls.at(0) as [string, RequestInit] | undefined
    const requestBody = JSON.parse(String(firstCall?.[1]?.body))
    expect(requestBody.clientId).toBe('client_sharedterminal')
    expect(window.localStorage.getItem('goblin:web-terminal-client-id')).toBe('web_oldpersistedclient')
  })

  test('includes the current attachment id when creating a terminal in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        action: 'created',
        key: '/tmp/repo\u0000/tmp/repo\u0000terminal-1',
        sessions: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')

    await terminalBridge.create({
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })

    const firstCall = fetchMock.mock.calls.at(0) as [string, RequestInit] | undefined
    const requestBody = JSON.parse(String(firstCall?.[1]?.body))
    expect(requestBody).toMatchObject({
      clientId: 'client_sharedterminal',
      attachmentId: expect.stringMatching(/^attachment_/),
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })
  })

  test('rejects invalid terminal session list payloads from the server', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ sessionId: 'term_1', key: 123 }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')

    await expect(terminalBridge.listSessions({ repoRoot: '/tmp/repo' })).rejects.toThrow(
      'invalid terminal sessions response',
    )
  })

  test('rejects invalid terminal session snapshot payloads from the server', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessionId: 'term_1', snapshotSeq: 'bad' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')

    await expect(terminalBridge.getSessionSnapshot({ sessionId: 'term_1' })).rejects.toThrow(
      'invalid terminal session snapshot response',
    )
  })

  test('forwards terminal output, title, and exit events from the web socket', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const onOutput = vi.fn()
    const onTitle = vi.fn()
    const onExit = vi.fn()
    const onOwnership = vi.fn()
    const onSessionsChanged = vi.fn()

    const disposeOutput = terminalBridge.onOutput(onOutput)
    const disposeTitle = terminalBridge.onTitle(onTitle)
    const disposeExit = terminalBridge.onExit(onExit)
    const disposeOwnership = terminalBridge.onOwnership(onOwnership)
    const disposeSessionsChanged = terminalBridge.onSessionsChanged(onSessionsChanged)
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing web terminal socket')

    socket.emitMessage(
      JSON.stringify({
        type: 'title',
        event: { sessionId: 'term_1', canonicalTitle: '~/Developer/goblin — npm run dev' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { sessionId: 'term_1', data: 'hello', seq: 1, processName: 'zsh' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'exit',
        event: { sessionId: 'term_1' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'ownership',
        event: { sessionId: 'term_1', controller: null, cols: 100, rows: 30 },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'sessions-changed',
        repoRoot: '/tmp/repo',
      }),
    )

    expect(onOutput).toHaveBeenCalledWith({ sessionId: 'term_1', data: 'hello', seq: 1, processName: 'zsh' })
    expect(onTitle).toHaveBeenCalledWith({ sessionId: 'term_1', canonicalTitle: '~/Developer/goblin — npm run dev' })
    expect(onExit).toHaveBeenCalledWith({ sessionId: 'term_1' })
    expect(onOwnership).toHaveBeenCalledWith({
      sessionId: 'term_1',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    expect(onSessionsChanged).toHaveBeenCalledWith('/tmp/repo')

    disposeOutput()
    disposeTitle()
    disposeExit()
    disposeOwnership()
    disposeSessionsChanged()
  })

  test('reuses a connecting terminal socket when subscribers briefly drop to zero', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const firstDispose = terminalBridge.onOutput(() => {})
    expect(MockWebSocket.instances).toHaveLength(1)

    firstDispose()
    const secondDispose = terminalBridge.onOutput(() => {})
    expect(MockWebSocket.instances).toHaveLength(1)

    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing web terminal socket')
    const onOutput = vi.fn()
    const disposeMessage = terminalBridge.onOutput(onOutput)
    socket.emitOpen()
    socket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { sessionId: 'term_1', data: 'hello', seq: 1, processName: 'zsh' },
      }),
    )

    expect(onOutput).toHaveBeenCalledTimes(1)
    secondDispose()
    disposeMessage()
  })

  test('ignores stale terminal socket events after reconnect creates a newer socket', async () => {
    vi.useFakeTimers()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const onOutput = vi.fn()
    const dispose = terminalBridge.onOutput(onOutput)
    const firstSocket = MockWebSocket.instances[0]
    if (!firstSocket) throw new Error('missing initial terminal socket')

    firstSocket.close()
    await vi.advanceTimersByTimeAsync(300)

    const secondSocket = MockWebSocket.instances[1]
    if (!secondSocket) throw new Error('missing reconnected terminal socket')

    firstSocket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { sessionId: 'term_old', data: 'stale', seq: 1, processName: 'zsh' },
      }),
    )
    secondSocket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { sessionId: 'term_new', data: 'fresh', seq: 2, processName: 'zsh' },
      }),
    )

    expect(onOutput).toHaveBeenCalledTimes(1)
    expect(onOutput).toHaveBeenCalledWith({ sessionId: 'term_new', data: 'fresh', seq: 2, processName: 'zsh' })
    dispose()
    vi.useRealTimers()
  })

  test('emits terminal bell click events from browser notifications in web host mode', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const { onRendererLocalEventType, resetRendererLocalEventsForTests } = await import('#/web/local-events.ts')
    const bellClick = vi.fn()
    const dispose = onRendererLocalEventType('terminal-bell-click', bellClick)
    const key = '/tmp/repo\0/tmp/repo\0terminal-2'

    await expect(
      terminalBridge.notifyBell({ title: 'repo', body: 'feature/test\\nzsh', key, repoRoot: '/tmp/repo' }),
    ).resolves.toBe(true)
    mockNotifications[0]?.onclick?.()

    expect(bellClick).toHaveBeenCalledWith({ type: 'terminal-bell-click', repoRoot: '/tmp/repo', key })
    dispose()
    resetRendererLocalEventsForTests()
  })
})
