// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'
import { installHostBootstrap } from '#/web/test-utils/host-bootstrap.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
let wsMock: WebSocketMockHandle
const REPO_RUNTIME_ID = 'repo-runtime-test'
describe('terminal web host client', () => {
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
    const { terminalClient } = await import('#/web/terminal.ts')

    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    expect(socket?.url).toMatch(/^ws:\/\/127\.0\.0\.1:32100\/ws\/app\?t=secret&clientId=client_sharedterminal$/)
    const attachPromise = terminalClient.attach({
      terminalRuntimeSessionId: 'pty_1234567890123456',
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
        terminalRuntimeSessionId: 'pty_1234567890123456',
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
          terminalRuntimeSessionId: 'pty_1234567890123456',
          snapshot: '',
          snapshotSeq: 0,
          outputEra: 0,
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
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    const attachPromise = terminalClient.attach({
      terminalRuntimeSessionId: 'pty_1234567890123456',
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
          terminalRuntimeSessionId: 'pty_1234567890123456',
          snapshot: '',
          snapshotSeq: 0,
          outputEra: 0,
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

  test('uses the websocket client id when resolving identity role', async () => {
    window.localStorage.setItem('goblin:terminal-client-id', 'web_oldpersistedclient')
    window.sessionStorage.setItem('goblin:terminal-client-id', 'web_oldsessionclient')
    const { terminalClient } = await import('#/web/terminal.ts')
    const onIdentity = vi.fn()
    const dispose = terminalClient.onIdentity(onIdentity)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')
    socket.emitOpen()

    socket.emitMessage(
      JSON.stringify({
        type: 'identity',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          controller: { clientId: 'client_sharedterminal', status: 'connected' },
          canonicalCols: 100,
          canonicalRows: 30,
        },
      }),
    )

    expect(socket.url).toContain('clientId=client_sharedterminal')
    expect(onIdentity).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    dispose()
  })

  test('does not fall back to http when attach websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    const attachPromise = terminalClient.attach({
      terminalRuntimeSessionId: 'pty_1234567890123456',
      cols: 100,
      rows: 30,
    })

    socket?.close()

    await expect(attachPromise).rejects.toThrow('App realtime socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when write websocket is unavailable', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    const writePromise = terminalClient.write({
      terminalRuntimeSessionId: 'pty_1234567890123456',
      data: 'pwd',
    })

    socket?.close()

    await expect(writePromise).rejects.toThrow('App realtime socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('loads terminal session lists through websocket request-response and validates payloads', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]

    const listPromise = terminalClient.listSessions({ repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID })
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
        repoRuntimeId: REPO_RUNTIME_ID,
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'list-sessions',
        payload: [{ terminalRuntimeSessionId: 'pty_1', terminalSessionId: 123 }],
      }),
    )

    await expect(listPromise).rejects.toThrow('Invalid terminal socket response payload')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('loads workspace pane tabs through namespaced websocket actions', async () => {
    const fetchMock = mockFetch()
    const { workspacePaneTabsClient } = await import('#/web/workspace-pane/workspace-pane-tabs-client.ts')

    const listPromise = workspacePaneTabsClient.list({ repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID })
    const socket = wsMock.instances[0]
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list)
    expect(request).toMatchObject({
      type: 'request',
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      input: {
        repoRoot: '/tmp/repo',
        repoRuntimeId: REPO_RUNTIME_ID,
      },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        payload: { revision: 0, entries: [] },
      }),
    )

    await expect(listPromise).resolves.toEqual({ revision: 0, entries: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('opens a fresh socket for a request when the tracked socket is already closed', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const staleSocket = wsMock.instances[0]
    if (!staleSocket) throw new Error('missing web terminal socket')

    dispose()
    staleSocket.readyState = wsMock.CLOSED

    const listPromise = terminalClient.listSessions({ repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID })
    expect(wsMock.instances).toHaveLength(2)
    const socket = wsMock.instances[1]
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'list-sessions')
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'list-sessions',
        payload: [],
      }),
    )

    await expect(listPromise).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('request cancels a pending idle close on a connecting realtime socket', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')

    dispose()
    const listPromise = terminalClient.listSessions({ repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID })
    expect(wsMock.instances).toHaveLength(1)
    socket.emitOpen()
    await Promise.resolve()
    const request = socket.sent
      .map((payload) => JSON.parse(payload))
      .find((message) => message.action === 'list-sessions')
    expect(request).toMatchObject({ action: 'list-sessions' })
    socket.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'list-sessions',
        payload: [],
      }),
    )

    await expect(listPromise).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('times out session list loading when websocket stays connecting', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = mockFetch()
      const { terminalClient } = await import('#/web/terminal.ts')
      const listPromise = terminalClient.listSessions({
        repoRoot: '/tmp/repo',
        repoRuntimeId: REPO_RUNTIME_ID,
      })
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      const expectation = expect(listPromise).rejects.toThrow('App realtime socket open timed out')

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
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    const listPromise = terminalClient.listSessions({ repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID })

    socket?.close()

    await expect(listPromise).rejects.toThrow('App realtime socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when prune websocket cannot open', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    const prunePromise = terminalClient.pruneTerminals('/tmp/repo', REPO_RUNTIME_ID)

    socket?.close()

    await expect(prunePromise).rejects.toThrow('App realtime socket closed before open')
    expect(fetchMock).not.toHaveBeenCalled()
    dispose()
  })

  test('does not fall back to http when prune uses websocket request-response', async () => {
    const fetchMock = mockFetch()
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    const prunePromise = terminalClient.pruneTerminals('/tmp/repo', REPO_RUNTIME_ID)
    socket?.emitOpen()
    await Promise.resolve()
    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
    expect(request).toMatchObject({
      type: 'request',
      action: 'prune',
      input: { repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID },
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
    const { terminalClient } = await import('#/web/terminal.ts')
    const prunePromise = terminalClient.pruneTerminals('/tmp/repo', REPO_RUNTIME_ID)
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
      const { terminalClient } = await import('#/web/terminal.ts')
      const prunePromise = terminalClient.pruneTerminals('/tmp/repo', REPO_RUNTIME_ID)
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')

      socket.emitOpen()
      await Promise.resolve()
      const request = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
      expect(request).toMatchObject({
        type: 'request',
        action: 'prune',
        input: { repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID },
      })
      const expectation = expect(prunePromise).rejects.toThrow('App realtime request timed out')

      await vi.advanceTimersByTimeAsync(30_000)

      await expectation
      expect(socket.readyState).toBe(wsMock.CLOSED)
    } finally {
      vi.useRealTimers()
    }
  })

  test('sends terminal heartbeat messages while the realtime socket is open', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()

      await vi.advanceTimersByTimeAsync(30_000)

      expect(socket.sent.map((payload) => JSON.parse(payload))).toContainEqual({ type: 'heartbeat' })
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('heartbeat send failure closes and reconnects an unhealthy realtime socket', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()
      await vi.advanceTimersByTimeAsync(1_000)
      const prunePromise = terminalClient.pruneTerminals('/tmp/repo', REPO_RUNTIME_ID)
      await Promise.resolve()
      const request = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
      expect(request).toMatchObject({
        type: 'request',
        action: 'prune',
        input: { repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID },
      })
      socket.send = vi.fn(() => {
        throw new Error('send failed')
      })
      const expectation = expect(prunePromise).rejects.toThrow('App realtime heartbeat send failed')

      await vi.advanceTimersByTimeAsync(29_000)

      await expectation
      expect(socket.readyState).toBe(wsMock.CLOSED)
      await vi.advanceTimersByTimeAsync(300)
      expect(wsMock.instances).toHaveLength(2)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('request timeout closes an unhealthy socket even while subscribers keep realtime open', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()
      await Promise.resolve()

      const prunePromise = terminalClient.pruneTerminals('/tmp/repo', REPO_RUNTIME_ID)
      await Promise.resolve()
      const request = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.action === 'prune')
      expect(request).toMatchObject({
        type: 'request',
        action: 'prune',
        input: { repoRoot: '/tmp/repo', repoRuntimeId: REPO_RUNTIME_ID },
      })
      const expectation = expect(prunePromise).rejects.toThrow('App realtime request timed out')

      await vi.advanceTimersByTimeAsync(30_000)
      await expectation
      expect(socket.readyState).toBe(wsMock.CLOSED)

      await vi.advanceTimersByTimeAsync(300)
      expect(wsMock.instances).toHaveLength(2)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('forwards terminal output, bell, title, and exit events from the web socket', async () => {
    const { terminalClient } = await import('#/web/terminal.ts')
    const { workspacePaneTabsClient } = await import('#/web/workspace-pane/workspace-pane-tabs-client.ts')
    const onOutput = vi.fn()
    const onBell = vi.fn()
    const onTitle = vi.fn()
    const onExit = vi.fn()
    const onIdentity = vi.fn()
    const onLifecycle = vi.fn()
    const onSessionsChanged = vi.fn()
    const onWorkspaceTabsChanged = vi.fn()

    const disposeOutput = terminalClient.onOutput(onOutput)
    const disposeBell = terminalClient.onBell(onBell)
    const disposeTitle = terminalClient.onTitle(onTitle)
    const disposeExit = terminalClient.onExit(onExit)
    const disposeIdentity = terminalClient.onIdentity(onIdentity)
    const disposeLifecycle = terminalClient.onLifecycle(onLifecycle)
    const disposeSessionsChanged = terminalClient.onSessionsChanged(onSessionsChanged)
    const disposeWorkspaceTabsChanged = workspacePaneTabsClient.onChanged(onWorkspaceTabsChanged)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')

    socket.emitMessage(
      JSON.stringify({
        type: 'title',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: '/tmp/repo',
          worktreePath: '/tmp/repo-worktree',
          canonicalTitle: '~/Developer/goblin — npm run dev',
        },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          data: 'hello',
          seq: 1,
          outputEra: 0,
          processName: 'zsh',
        },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'bell',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: '/tmp/repo',
          worktreePath: '/tmp/repo-worktree',
          processName: 'zsh',
          canonicalTitle: null,
        },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'exit',
        event: { terminalRuntimeSessionId: 'pty_1', terminalSessionId: 'term-111111111111111111111' },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'identity',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          controller: null,
          canonicalCols: 100,
          canonicalRows: 30,
        },
      }),
    )
    socket.emitMessage(
      JSON.stringify({
        type: 'lifecycle',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          phase: 'open',
          message: null,
          takeoverPending: false,
        },
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
        type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
        repoRoot: '/tmp/repo',
      }),
    )

    expect(onOutput).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
      data: 'hello',
      seq: 1,
      outputEra: 0,
      processName: 'zsh',
    })
    expect(onBell).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: '/tmp/repo',
      worktreePath: '/tmp/repo-worktree',
      processName: 'zsh',
      canonicalTitle: null,
    })
    expect(onTitle).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: '/tmp/repo',
      worktreePath: '/tmp/repo-worktree',
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })
    expect(onExit).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
    })
    expect(onIdentity).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
      role: 'unowned',
      controllerStatus: 'none',
      canonicalCols: 100,
      canonicalRows: 30,
    })
    expect(onLifecycle).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'pty_1',
      terminalSessionId: 'term-111111111111111111111',
      phase: 'open',
      message: null,
      takeoverPending: false,
    })
    expect(onSessionsChanged).toHaveBeenCalledWith('/tmp/repo')
    expect(onWorkspaceTabsChanged).toHaveBeenCalledWith('/tmp/repo')

    disposeOutput()
    disposeBell()
    disposeTitle()
    disposeExit()
    disposeIdentity()
    disposeLifecycle()
    disposeSessionsChanged()
    disposeWorkspaceTabsChanged()
  })

  test('kickReconnect health-probes an open app realtime socket and keeps it when pong arrives', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const { appRealtimeClient } = await import('#/web/app-realtime.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()

      appRealtimeClient.kickReconnect()
      const ping = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'ping')
      expect(ping).toMatchObject({ type: 'ping' })
      socket.emitMessage(JSON.stringify({ type: 'pong', requestId: ping.requestId }))
      await vi.advanceTimersByTimeAsync(5_000)

      expect(socket.readyState).toBe(wsMock.OPEN)
      expect(wsMock.instances).toHaveLength(1)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('kickReconnect does not stack duplicate health probes for the same open socket', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const { appRealtimeClient } = await import('#/web/app-realtime.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()

      appRealtimeClient.kickReconnect()
      appRealtimeClient.kickReconnect()

      expect(
        socket.sent.map((payload) => JSON.parse(payload)).filter((message) => message.type === 'ping'),
      ).toHaveLength(1)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('kickReconnect reconnects an open app realtime socket when health probe send fails', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const { appRealtimeClient } = await import('#/web/app-realtime.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()
      socket.send = vi.fn(() => {
        throw new Error('send failed')
      })

      appRealtimeClient.kickReconnect()

      expect(socket.readyState).toBe(wsMock.CLOSED)
      await vi.advanceTimersByTimeAsync(300)
      expect(wsMock.instances).toHaveLength(2)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('kickReconnect reconnects an open app realtime socket when health probe times out', async () => {
    vi.useFakeTimers()
    try {
      const { terminalClient } = await import('#/web/terminal.ts')
      const { appRealtimeClient } = await import('#/web/app-realtime.ts')
      const dispose = terminalClient.onOutput(() => {})
      const socket = wsMock.instances[0]
      if (!socket) throw new Error('missing web terminal socket')
      socket.emitOpen()

      appRealtimeClient.kickReconnect()
      const ping = socket.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'ping')
      expect(ping).toMatchObject({ type: 'ping' })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(socket.readyState).toBe(wsMock.CLOSED)

      await vi.advanceTimersByTimeAsync(300)
      expect(wsMock.instances).toHaveLength(2)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('kickReconnect replaces a closing app realtime socket while realtime subscribers remain', async () => {
    const { terminalClient } = await import('#/web/terminal.ts')
    const { appRealtimeClient } = await import('#/web/app-realtime.ts')
    const dispose = terminalClient.onOutput(() => {})
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')
    socket.readyState = wsMock.CLOSING

    appRealtimeClient.kickReconnect()

    expect(wsMock.instances).toHaveLength(2)
    dispose()
  })

  test('reuses a connecting terminal socket when subscribers briefly drop to zero', async () => {
    const { terminalClient } = await import('#/web/terminal.ts')
    const firstDispose = terminalClient.onOutput(() => {})
    expect(wsMock.instances).toHaveLength(1)

    firstDispose()
    const secondDispose = terminalClient.onOutput(() => {})
    expect(wsMock.instances).toHaveLength(1)

    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing web terminal socket')
    const onOutput = vi.fn()
    const disposeMessage = terminalClient.onOutput(onOutput)
    socket.emitOpen()
    socket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'pty_1',
          terminalSessionId: 'term-111111111111111111111',
          data: 'hello',
          seq: 1,
          outputEra: 0,
          processName: 'zsh',
        },
      }),
    )

    expect(onOutput).toHaveBeenCalledTimes(1)
    secondDispose()
    disposeMessage()
  })

  test('ignores stale terminal socket events after reconnect creates a newer socket', async () => {
    vi.useFakeTimers()
    const { terminalClient } = await import('#/web/terminal.ts')
    const onOutput = vi.fn()
    const dispose = terminalClient.onOutput(onOutput)
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing initial terminal socket')

    firstSocket.close()
    await vi.advanceTimersByTimeAsync(300)

    const secondSocket = wsMock.instances[1]
    if (!secondSocket) throw new Error('missing reconnected terminal socket')

    firstSocket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'term_old',
          terminalSessionId: 'term-oldoldoldoldoldoldold',
          data: 'stale',
          seq: 1,
          outputEra: 0,
          processName: 'zsh',
        },
      }),
    )
    secondSocket.emitMessage(
      JSON.stringify({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'term_new',
          terminalSessionId: 'term-newnewnewnewnewnewnew',
          data: 'fresh',
          seq: 2,
          outputEra: 0,
          processName: 'zsh',
        },
      }),
    )

    expect(onOutput).toHaveBeenCalledTimes(1)
    expect(onOutput).toHaveBeenCalledWith({
      terminalRuntimeSessionId: 'term_new',
      terminalSessionId: 'term-newnewnewnewnewnewnew',
      data: 'fresh',
      seq: 2,
      outputEra: 0,
      processName: 'zsh',
    })
    dispose()
    vi.useRealTimers()
  })

  test('stops reconnecting terminal sockets after app quitting starts', async () => {
    vi.useFakeTimers()
    const { markAppQuitting } = await import('#/web/app-lifecycle.ts')
    const { terminalClient } = await import('#/web/terminal.ts')
    const dispose = terminalClient.onOutput(() => {})
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
    const { terminalClient } = await import('#/web/terminal.ts')
    const { onClientLocalEventType, resetClientLocalEventsForTests } = await import('#/web/local-events.ts')
    const bellClick = vi.fn()
    const dispose = onClientLocalEventType('terminal-bell-click', bellClick)
    const terminalSessionId = 'term-222222222222222222222'

    await expect(
      terminalClient.notifyBell({
        title: 'repo',
        body: 'feature/test\\nzsh',
        terminalSessionId,
        repoRoot: '/tmp/repo',
      }),
    ).resolves.toBe(true)
    wsMock.notificationInstances[0]?.onclick?.()

    expect(bellClick).toHaveBeenCalledWith({ type: 'terminal-bell-click', repoRoot: '/tmp/repo', terminalSessionId })
    dispose()
    resetClientLocalEventsForTests()
  })
})
