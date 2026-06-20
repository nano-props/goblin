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
  sent: string[] = []
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

  removeEventListener(type: string, cb: (event: any) => void) {
    this.listeners.get(type)?.delete(cb)
  }

  send(data: string) {
    this.sent.push(data)
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
    const createStorage = () => {
      const store: Record<string, string> = {}
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: (k: string) => {
          delete store[k]
        },
        clear: () => {
          for (const k of Object.keys(store)) delete store[k]
        },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() {
          return Object.keys(store).length
        },
      }
    }
    Object.defineProperty(window, 'localStorage', { value: createStorage(), configurable: true })
    Object.defineProperty(window, 'sessionStorage', { value: createStorage(), configurable: true })
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
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
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

  test('attaches terminals through terminal websocket request-response in web host mode', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')

    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    expect(socket?.url).toMatch(
      /^ws:\/\/127\.0\.0\.1:32100\/ws\/terminal\?t=secret&clientId=client_sharedterminal&attachmentId=attachment_/,
    )
    const attachPromise = terminalBridge.attach({
      sessionId: 'term_1234567890123456',
      cols: 100,
      rows: 30,
    })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'request')
    expect(request).toMatchObject({
      type: 'request',
      action: 'attach',
      input: {
        sessionId: 'term_1234567890123456',
        cols: 100,
        rows: 30,
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          sessionId: 'term_1234567890123456',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: null,
          canonicalCols: 100,
          canonicalRows: 30,
        },
      }),
    )

    await expect(attachPromise).resolves.toMatchObject({ ok: true, processName: 'zsh' })
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('prefers the bootstrap-provided shared terminal client id over localStorage state', async () => {
    window.localStorage.setItem('goblin:web-terminal-client-id', 'web_oldpersistedclient')
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const attachPromise = terminalBridge.attach({
      sessionId: 'term_1234567890123456',
      cols: 100,
      rows: 30,
    })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'request')
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          sessionId: 'term_1234567890123456',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: null,
          canonicalCols: 100,
          canonicalRows: 30,
        },
      }),
    )

    await attachPromise
    expect(socket?.url).toContain('clientId=client_sharedterminal')
    expect(window.localStorage.getItem('goblin:web-terminal-client-id')).toBe('web_oldpersistedclient')
    dispose()
  })

  test('does not fall back to http when attach websocket cannot open', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const attachPromise = terminalBridge.attach({
      sessionId: 'term_1234567890123456',
      cols: 100,
      rows: 30,
    })

    socket?.close()

    await expect(attachPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when write websocket is unavailable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const writePromise = terminalBridge.write({
      sessionId: 'term_1234567890123456',
      data: 'pwd',
    })

    socket?.close()

    await expect(writePromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('includes the current attachment id when creating a terminal in web host mode', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]

    const createPromise = terminalBridge.create({
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'create')
    expect(request).toMatchObject({
      type: 'request',
      action: 'create',
      input: {
        repoRoot: '/tmp/repo',
        branch: 'feature',
        worktreePath: '/tmp/repo',
        kind: 'primary',
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'create',
        payload: {
          ok: true,
          action: 'created',
          key: '/tmp/repo\u0000/tmp/repo\u0000terminal-1',
          sessions: [],
        },
      }),
    )

    await expect(createPromise).resolves.toMatchObject({
      ok: true,
      action: 'created',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(socket?.url).toMatch(/^ws:\/\//)
    dispose()
  })

  test('loads terminal session lists through websocket request-response and validates payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]

    const listPromise = terminalBridge.listSessions({ repoRoot: '/tmp/repo' })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'list-sessions')
    expect(request).toMatchObject({
      type: 'request',
      action: 'list-sessions',
      input: {
        repoRoot: '/tmp/repo',
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'list-sessions',
        payload: [{ sessionId: 'term_1', key: 123 }],
      }),
    )

    await expect(listPromise).rejects.toThrow('invalid terminal sessions response')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('loads workspace pane views through workspace-pane websocket action', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]

    const listPromise = terminalBridge.listViews({ repoRoot: '/tmp/repo' })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'workspace-pane:list-views')
    expect(request).toMatchObject({
      type: 'request',
      action: 'workspace-pane:list-views',
      input: {
        repoRoot: '/tmp/repo',
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'workspace-pane:list-views',
        payload: [{ type: 'changes', id: 'changes', worktreePath: '/tmp/repo', displayOrder: 0 }],
      }),
    )

    await expect(listPromise).resolves.toEqual([
      { type: 'changes', id: 'changes', worktreePath: '/tmp/repo', displayOrder: 0 },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('loads terminal snapshots through websocket request-response and validates payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]

    const snapshotPromise = terminalBridge.getSessionSnapshot({ sessionId: 'term_1234567890123456' })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'session-snapshot')
    expect(request).toMatchObject({
      type: 'request',
      action: 'session-snapshot',
      input: {
        sessionId: 'term_1234567890123456',
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'session-snapshot',
        payload: { sessionId: 'term_1', snapshotSeq: 'bad' },
      }),
    )

    await expect(snapshotPromise).rejects.toThrow('invalid terminal session snapshot response')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when create websocket cannot open', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const createPromise = terminalBridge.create({
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })

    socket?.close()

    await expect(createPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when list websocket cannot open', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const listPromise = terminalBridge.listSessions({ repoRoot: '/tmp/repo' })

    socket?.close()

    await expect(listPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when snapshot websocket cannot open', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const snapshotPromise = terminalBridge.getSessionSnapshot({ sessionId: 'term_1234567890123456' })

    socket?.close()

    await expect(snapshotPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when prune websocket cannot open', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const prunePromise = terminalBridge.pruneTerminals('/tmp/repo')

    socket?.close()

    await expect(prunePromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when prune uses websocket request-response', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const prunePromise = terminalBridge.pruneTerminals('/tmp/repo')
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
    expect(request).toMatchObject({
      type: 'request',
      action: 'prune',
      input: { repoRoot: '/tmp/repo' },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'prune',
        payload: { pruned: 1, remaining: 2 },
      }),
    )

    await expect(prunePromise).resolves.toEqual({ pruned: 1, remaining: 2 })
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('closes an idle terminal socket after a one-shot websocket request resolves without subscribers', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const prunePromise = terminalBridge.pruneTerminals('/tmp/repo')
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing web terminal socket')

    socket.emitOpen()
    await Promise.resolve()
    const request = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
    socket.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'prune',
        payload: { pruned: 1, remaining: 0 },
      }),
    )

    await expect(prunePromise).resolves.toEqual({ pruned: 1, remaining: 0 })
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
  })

  test('does not fall back to http when create/list/snapshot/prune websocket payloads resolve successfully', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    const createPromise = terminalBridge.create({
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })
    socket?.emitOpen()
    await Promise.resolve()
    const createRequest = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'create')
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: createRequest?.requestId,
        ok: true,
        action: 'create',
        payload: { ok: true, action: 'created', key: 'key_1', sessions: [] },
      }),
    )
    await expect(createPromise).resolves.toMatchObject({ ok: true, key: 'key_1' })
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('forwards terminal output, title, and exit events from the web socket', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const onOutput = vi.fn()
    const onTitle = vi.fn()
    const onExit = vi.fn()
    const onOwnership = vi.fn()
    const onSessionsChanged = vi.fn()
    const onWorkspacePaneChanged = vi.fn()

    const disposeOutput = terminalBridge.onOutput(onOutput)
    const disposeTitle = terminalBridge.onTitle(onTitle)
    const disposeExit = terminalBridge.onExit(onExit)
    const disposeOwnership = terminalBridge.onOwnership(onOwnership)
    const disposeSessionsChanged = terminalBridge.onSessionsChanged(onSessionsChanged)
    const disposeWorkspacePaneChanged = terminalBridge.onWorkspacePaneChanged(onWorkspacePaneChanged)
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
        event: { sessionId: 'term_1', controller: null, cols: 100, rows: 30, phase: 'open' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'sessions-changed',
        repoRoot: '/tmp/repo',
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'workspace-pane-changed',
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
      phase: 'open',
    })
    expect(onSessionsChanged).toHaveBeenCalledWith('/tmp/repo')
    expect(onWorkspacePaneChanged).toHaveBeenCalledWith('/tmp/repo')

    disposeOutput()
    disposeTitle()
    disposeExit()
    disposeOwnership()
    disposeSessionsChanged()
    disposeWorkspacePaneChanged()
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

  test('stops reconnecting terminal sockets after app quitting starts', async () => {
    vi.useFakeTimers()
    const { markAppQuitting } = await import('#/web/app-lifecycle.ts')
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing initial terminal socket')

    markAppQuitting()
    await vi.advanceTimersByTimeAsync(300)

    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(MockWebSocket.instances).toHaveLength(1)
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
