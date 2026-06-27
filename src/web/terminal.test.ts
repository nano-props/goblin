// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'
import { installHostBootstrap } from '#/web/test-utils/host-bootstrap.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
let wsMock: WebSocketMockHandle
describe('terminal web host bridge', () => {
  beforeEach(() => {
    wsMock = installWebSocketMock({ autoOpen: false })
    installHostBootstrap({
      runtime: 'web',
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
    })
    vi.restoreAllMocks()
    vi.resetModules()
    setClientBridgeForTests(null)
    wsMock.reset()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  test('attaches terminals through terminal websocket request-response in web host mode', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')

    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    expect(socket?.url).toMatch(/^ws:\/\/127\.0\.0\.1:32100\/ws\/terminal\?t=secret&clientId=client_sharedterminal$/)
    const attachPromise = terminalBridge.attach({
      ptySessionId: 'pty_1234567890123456',
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
        ptySessionId: 'pty_1234567890123456',
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
          ptySessionId: 'pty_1234567890123456',
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
    window.localStorage.setItem('goblin:terminal-client-id', 'web_oldpersistedclient')
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    const attachPromise = terminalBridge.attach({
      ptySessionId: 'pty_1234567890123456',
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
          ptySessionId: 'pty_1234567890123456',
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
    expect(window.localStorage.getItem('goblin:terminal-client-id')).toBe('web_oldpersistedclient')
    dispose()
  })

  test('does not fall back to http when attach websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    const attachPromise = terminalBridge.attach({
      ptySessionId: 'pty_1234567890123456',
      cols: 100,
      rows: 30,
    })

    socket?.close()

    await expect(attachPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when write websocket is unavailable', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    const writePromise = terminalBridge.write({
      ptySessionId: 'pty_1234567890123456',
      data: 'pwd',
    })

    socket?.close()

    await expect(writePromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('includes the current attachment id when creating a terminal in web host mode', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]

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
          key: '/tmp/repo\u0000/tmp/repo\u0000session-1',
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
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]

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
        payload: [{ ptySessionId: 'pty_1', key: 123 }],
      }),
    )

    await expect(listPromise).rejects.toThrow('invalid terminal sessions response')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('loads terminal snapshots through websocket request-response and validates payloads', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]

    const snapshotPromise = terminalBridge.getSessionSnapshot({ ptySessionId: 'pty_1234567890123456' })
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'session-snapshot')
    expect(request).toMatchObject({
      type: 'request',
      action: 'session-snapshot',
      input: {
        ptySessionId: 'pty_1234567890123456',
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'session-snapshot',
        payload: { ptySessionId: 'pty_1', snapshotSeq: 'bad' },
      }),
    )

    await expect(snapshotPromise).rejects.toThrow('invalid terminal session snapshot response')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when create websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
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

  test('rejects create when websocket errors before opening', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const createPromise = terminalBridge.create({
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')
    const expectation = expect(createPromise).rejects.toThrow('Terminal socket error before open')

    socket.emitError()

    await expectation
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('times out create when websocket stays connecting', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = mockFetch()
      const { terminalBridge } = await import('#/web/terminal.ts')
      const createPromise = terminalBridge.create({
        repoRoot: '/tmp/repo',
        branch: 'feature',
        worktreePath: '/tmp/repo',
        kind: 'primary',
      })
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      const expectation = expect(createPromise).rejects.toThrow('Terminal socket open timed out')

      await vi.advanceTimersByTimeAsync(10_000)

      await expectation
      expect(fetchMock).not.toHaveBeenCalled()
      expect(socket.readyState).toBe(wsMock.CLOSED)
    } finally {
      vi.useRealTimers()
    }
  })

  test('times out session list loading when websocket stays connecting', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = mockFetch()
      const { terminalBridge } = await import('#/web/terminal.ts')
      const listPromise = terminalBridge.listSessions({ repoRoot: '/tmp/repo' })
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      const expectation = expect(listPromise).rejects.toThrow('Terminal socket open timed out')

      await vi.advanceTimersByTimeAsync(10_000)

      await expectation
      expect(fetchMock).not.toHaveBeenCalled()
      expect(socket.readyState).toBe(wsMock.CLOSED)
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not fall back to http when list websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    const listPromise = terminalBridge.listSessions({ repoRoot: '/tmp/repo' })

    socket?.close()

    await expect(listPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when snapshot websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    const snapshotPromise = terminalBridge.getSessionSnapshot({ ptySessionId: 'pty_1234567890123456' })

    socket?.close()

    await expect(snapshotPromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when prune websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    const prunePromise = terminalBridge.pruneTerminals('/tmp/repo')

    socket?.close()

    await expect(prunePromise).rejects.toThrow('Terminal socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when prune uses websocket request-response', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
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
    const socket = wsMock.instances[0]
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
    expect(socket.readyState).toBe(wsMock.CLOSED)
  })

  test('closes an idle terminal socket after a one-shot websocket request times out without subscribers', async () => {
    vi.useFakeTimers()
    try {
      const { terminalBridge } = await import('#/web/terminal.ts')
      const prunePromise = terminalBridge.pruneTerminals('/tmp/repo')
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')

      socket.emitOpen()
      await Promise.resolve()
      const request = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
      expect(request).toMatchObject({ type: 'request', action: 'prune' })
      const expectation = expect(prunePromise).rejects.toThrow('Terminal request timed out')

      await vi.advanceTimersByTimeAsync(30_000)

      await expectation
      expect(socket.readyState).toBe(wsMock.CLOSED)
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not fall back to http when create/list/snapshot/prune websocket payloads resolve successfully', async () => {
    const fetchMock = mockFetch()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
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
    const onIdentity = vi.fn()
    const onLifecycle = vi.fn()
    const onSessionsChanged = vi.fn()

    const disposeOutput = terminalBridge.onOutput(onOutput)
    const disposeTitle = terminalBridge.onTitle(onTitle)
    const disposeExit = terminalBridge.onExit(onExit)
    const disposeIdentity = terminalBridge.onIdentity(onIdentity)
    const disposeLifecycle = terminalBridge.onLifecycle(onLifecycle)
    const disposeSessionsChanged = terminalBridge.onSessionsChanged(onSessionsChanged)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')

    socket.emitMessage(
      JSON.stringify({
        type: 'title',
        event: { ptySessionId: 'pty_1', canonicalTitle: '~/Developer/goblin — npm run dev' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { ptySessionId: 'pty_1', data: 'hello', seq: 1, processName: 'zsh' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'exit',
        event: { ptySessionId: 'pty_1' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'identity',
        event: { ptySessionId: 'pty_1', controller: null, canonicalCols: 100, canonicalRows: 30 },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'lifecycle',
        event: { ptySessionId: 'pty_1', phase: 'open', message: null, takeoverPending: false },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'sessions-changed',
        repoRoot: '/tmp/repo',
      }),
    )

    expect(onOutput).toHaveBeenCalledWith({ ptySessionId: 'pty_1', data: 'hello', seq: 1, processName: 'zsh' })
    expect(onTitle).toHaveBeenCalledWith({ ptySessionId: 'pty_1', canonicalTitle: '~/Developer/goblin — npm run dev' })
    expect(onExit).toHaveBeenCalledWith({ ptySessionId: 'pty_1' })
    expect(onIdentity).toHaveBeenCalledWith({
      ptySessionId: 'pty_1',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    expect(onLifecycle).toHaveBeenCalledWith({
      ptySessionId: 'pty_1',
      phase: 'open',
      message: null,
      takeoverPending: false,
    })
    expect(onSessionsChanged).toHaveBeenCalledWith('/tmp/repo')

    disposeOutput()
    disposeTitle()
    disposeExit()
    disposeIdentity()
    disposeLifecycle()
    disposeSessionsChanged()
  })

  test('reuses a connecting terminal socket when subscribers briefly drop to zero', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const firstDispose = terminalBridge.onOutput(() => {})
    expect(wsMock.instances).toHaveLength(1)

    firstDispose()
    const secondDispose = terminalBridge.onOutput(() => {})
    expect(wsMock.instances).toHaveLength(1)

    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')
    const onOutput = vi.fn()
    const disposeMessage = terminalBridge.onOutput(onOutput)
    socket.emitOpen()
    socket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { ptySessionId: 'pty_1', data: 'hello', seq: 1, processName: 'zsh' },
      }),
    )

    expect(onOutput).toHaveBeenCalledTimes(1)
    secondDispose()
    disposeMessage()
  })

  test('keeps a connecting terminal socket open when a one-shot request arrives after subscribers drop', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    expect(wsMock.instances).toHaveLength(1)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')

    dispose()
    const createPromise = terminalBridge.create({
      repoRoot: '/tmp/repo',
      branch: 'feature',
      worktreePath: '/tmp/repo',
      kind: 'primary',
    })
    socket.emitOpen()
    await Promise.resolve()

    expect(socket.readyState).toBe(wsMock.OPEN)
    const request = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'create')
    expect(request).toMatchObject({ type: 'request', action: 'create' })
    socket.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'create',
        payload: { ok: true, action: 'created', key: 'key_1', sessions: [] },
      }),
    )

    await expect(createPromise).resolves.toMatchObject({ ok: true, key: 'key_1' })
    expect(socket.readyState).toBe(wsMock.CLOSED)
  })

  test('ignores stale terminal socket events after reconnect creates a newer socket', async () => {
    vi.useFakeTimers()
    const { terminalBridge } = await import('#/web/terminal.ts')
    const onOutput = vi.fn()
    const dispose = terminalBridge.onOutput(onOutput)
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing initial terminal socket')

    firstSocket.close()
    await vi.advanceTimersByTimeAsync(300)

    const secondSocket = wsMock.instances[1]
    if (!secondSocket) throw new Error('missing reconnected terminal socket')

    firstSocket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { ptySessionId: 'term_old', data: 'stale', seq: 1, processName: 'zsh' },
      }),
    )
    secondSocket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: { ptySessionId: 'term_new', data: 'fresh', seq: 2, processName: 'zsh' },
      }),
    )

    expect(onOutput).toHaveBeenCalledTimes(1)
    expect(onOutput).toHaveBeenCalledWith({ ptySessionId: 'term_new', data: 'fresh', seq: 2, processName: 'zsh' })
    dispose()
    vi.useRealTimers()
  })

  test('stops reconnecting terminal sockets after app quitting starts', async () => {
    vi.useFakeTimers()
    const { markAppQuitting } = await import('#/web/app-lifecycle.ts')
    const { terminalBridge } = await import('#/web/terminal.ts')
    const dispose = terminalBridge.onOutput(() => {})
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing initial terminal socket')

    markAppQuitting()
    await vi.advanceTimersByTimeAsync(300)

    expect(socket.readyState).toBe(wsMock.CLOSED)
    expect(wsMock.instances).toHaveLength(1)
    dispose()
    vi.useRealTimers()
  })

  test('emits terminal bell click events from browser notifications in web host mode', async () => {
    const { terminalBridge } = await import('#/web/terminal.ts')
    const { onClientLocalEventType, resetClientLocalEventsForTests } = await import('#/web/local-events.ts')
    const bellClick = vi.fn()
    const dispose = onClientLocalEventType('terminal-bell-click', bellClick)
    const key = '/tmp/repo\0/tmp/repo\0session-2'

    await expect(
      terminalBridge.notifyBell({ title: 'repo', body: 'feature/test\\nzsh', key, repoRoot: '/tmp/repo' }),
    ).resolves.toBe(true)
    wsMock.notificationInstances[0]?.onclick?.()

    expect(bellClick).toHaveBeenCalledWith({ type: 'terminal-bell-click', repoRoot: '/tmp/repo', key })
    dispose()
    resetClientLocalEventsForTests()
  })
})
