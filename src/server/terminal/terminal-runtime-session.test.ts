import { describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import {
  REPO_ROOT,
  USER_1,
  WORKSPACE_RUNTIME_ID,
  appRealtimeSocket,
  buildRuntime,
  createLocalWorktreeTerminal,
  mockPtys,
  requestWorkspacePaneRuntime,
  requestWorkspacePaneTabs,
  sentSocketMessages,
  startControlledTerminalRuntime,
  workspacePaneTabsListInput,
  workspacePaneWorktreeTarget,
} from '#/server/test-utils/terminal-runtime.ts'

describe('server terminal runtime sessions', () => {
  test('opens a Git terminal from one target-catalog capture', async () => {
    const captureTargets = vi.fn(
      async (...args: Parameters<WorkspacePaneTargetProjectionProvider['captureTargets']>) => {
        const scope = args[2]
        return [
          {
            target: workspacePaneWorktreeTarget(scope.slice(scope.lastIndexOf('\0') + 1)),
            nativeWorktreePath: '/repo-linked',
            canonicalBranch: 'feature',
          },
        ]
      },
    )
    const { host, shutdown } = buildRuntime({ captureTargets })
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)

    await expect(
      requestWorkspacePaneRuntime(
        host,
        socket,
        {
          runtimeType: 'terminal',
          request: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
            kind: 'additional',
          },
        },
        'req_open_single_catalog_capture',
      ),
    ).resolves.toMatchObject({ ok: true })
    expect(captureTargets).toHaveBeenCalledOnce()

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('create prepares a session without controller control or geometry', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)

    const result = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      terminalSessionId: result.terminalSessionId,
      controller: null,
      phase: 'opening',
      message: null,
      terminalRuntimeGeneration: 0,
      canonicalSize: null,
    })
    expect(result).not.toHaveProperty('sessions')
    const terminalRuntimeSessionId = result.terminalRuntimeSessionId

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        phase: 'opening',
        message: null,
      }),
    ])
    expect(mockPtys).toHaveLength(0)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('application create and fresh binding activation both invalidate terminal sessions', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)

    const result = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')

    expect(result.ok).toBe(true)
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 1 },
    ])
    expect(
      sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
    ).toBe(true)
    if (!result.ok) return

    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId: result.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      terminalProjectionEffect: { kind: 'delta', revision: 2 },
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 1 },
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 2 },
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a second attachment can attach as viewer without stealing controller control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)

    const createResult = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.terminalRuntimeSessionId
    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })

    const attachResult = await host.attach('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 120,
      rows: 40,
    })
    expect(attachResult).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalSize: { cols: 80, rows: 24 },
    })

    const sessions = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('reattaching after presence goes offline auto-reclaims control and canonical geometry', async () => {
    // The previous revision had a 30s grace sub-state that kept the
    // controller role occupied between offline and online transitions. The
    // current model keeps controller intent but derives the effective
    // controller from broker presence, so a reattach can reclaim with
    // fresh geometry when no effective controller is present.
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)

    const createResult = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'additional')
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.terminalRuntimeSessionId

    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })

    host.unregisterSocket('client_a', USER_1, socketA)
    const socketA2 = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA2)

    const reattachResult = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 101,
      rows: 31,
    })
    expect(reattachResult).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalSize: { cols: 101, rows: 31 },
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    const sessions = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalSize: { cols: 101, rows: 31 },
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA2)
    shutdown()
  })

  test('realtime attach injects the socket clientId and resizes an owned session to the live terminal size', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)

    const createResult = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.terminalRuntimeSessionId
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_resize',
        action: 'attach',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 0, cols: 101, rows: 31 },
      }),
    )

    await vi.waitFor(() => {
      expect(socket.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
    })

    const response = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'response' && message.requestId === 'req_attach_resize')
    expect(response).toMatchObject({
      type: 'response',
      requestId: 'req_attach_resize',
      ok: true,
      action: 'attach',
      payload: {
        ok: true,
        frame: 'stream',
        terminalRuntimeSessionId,
        phase: 'open',
        message: null,
        canonicalSize: { cols: 101, rows: 31 },
        controller: { clientId: 'client_a', status: 'connected' },
      },
    })
    expect(mockPtys[0]?.resize).not.toHaveBeenCalled()

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('broadcasts output, title, bell, and exit events to registered web terminal sockets', async () => {
    const { host, shutdown, socket, terminalRuntimeSessionId } = await startControlledTerminalRuntime()

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(result.ok).toBe(true)

    mockPtys[0]?.emitData('hello')
    const outputMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'output')
    expect(outputMessage).toMatchObject({
      type: 'output',
      event: { terminalRuntimeSessionId, terminalSessionId: expect.any(String), data: 'hello', seq: 1 },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b]0;build running\x07done\x07')
    const bellMessage = sentSocketMessages(socket).find((message) => message.type === 'bell')
    expect(bellMessage).toMatchObject({
      type: 'bell',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        processName: 'zsh',
        canonicalTitle: 'build running',
      },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b[22;0t\x1b]0;devin: hello\x07\x1b]30;devin: hello\x07')
    const devinTitleMessage = sentSocketMessages(socket).find((message) => message.type === 'title')
    expect(devinTitleMessage).toMatchObject({
      type: 'title',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        canonicalTitle: 'devin: hello',
      },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x07\x1b]0;after bell\x07')
    const bellThenTitleMessages = sentSocketMessages(socket)
    expect(bellThenTitleMessages.map((message) => message.type)).toEqual(['bell', 'title', 'output'])
    expect(bellThenTitleMessages[0]).toMatchObject({
      type: 'bell',
      event: { terminalRuntimeSessionId, canonicalTitle: 'devin: hello' },
    })
    expect(bellThenTitleMessages[1]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'after bell' },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b]0;first\x07\x07\x1b]0;second\x07')
    const titleBellTitleMessages = sentSocketMessages(socket)
    expect(titleBellTitleMessages.map((message) => message.type)).toEqual(['title', 'bell', 'title', 'output'])
    expect(titleBellTitleMessages[0]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'first' },
    })
    expect(titleBellTitleMessages[1]).toMatchObject({
      type: 'bell',
      event: { terminalRuntimeSessionId, canonicalTitle: 'first' },
    })
    expect(titleBellTitleMessages[2]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'second' },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x9d2;devin running\x9c')
    const titleMessage = sentSocketMessages(socket).find((message) => message.type === 'title')
    expect(titleMessage).toMatchObject({
      type: 'title',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        canonicalTitle: 'devin running',
      },
    })

    mockPtys[0]?.emitExit()
    let exitMessage: unknown
    await vi.waitFor(() => {
      exitMessage = socket.send.mock.calls
        .map(([payload]) => JSON.parse(String(payload)))
        .find((message) => message.type === 'exit')
      expect(exitMessage).toBeDefined()
    })
    expect(exitMessage).toMatchObject({
      type: 'exit',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
    })
    expect(host.getDiagnostics().terminal.pty.state).toBe('idle')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('clears stale title on non-shell to shell transition before emitting same-chunk bell', async () => {
    const { host, shutdown, socket, terminalRuntimeSessionId } = await startControlledTerminalRuntime()

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 80,
      rows: 24,
    })
    expect(result.ok).toBe(true)

    mockPtys[0]?.setProcessName('vim')
    mockPtys[0]?.emitData('\x1b]0;vim editing\x07')
    expect(sentSocketMessages(socket).find((message) => message.type === 'title')).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'vim editing' },
    })

    socket.send.mockClear()
    mockPtys[0]?.setProcessName('zsh')
    mockPtys[0]?.emitData('\x07$ ')
    const messages = sentSocketMessages(socket)
    expect(messages.map((message) => message.type)).toEqual(['title', 'bell', 'output'])
    expect(messages[0]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: null },
    })
    expect(messages[1]).toMatchObject({
      type: 'bell',
      event: { terminalRuntimeSessionId, processName: 'zsh', canonicalTitle: null },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reconciles workspace tabs when a PTY exits naturally', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          kind: 'additional',
        },
      },
      'req_open_terminal_before_exit',
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId: opened.runtime.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })
    socket.send.mockClear()

    mockPtys[0]?.emitExit()

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toHaveLength(1)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        'req_list_after_exit',
      ),
    ).resolves.toMatchObject({ entries: [] })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })
})
