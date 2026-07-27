import { describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { WORKSPACE_PANE_TABS_REALTIME_EVENTS } from '#/shared/workspace-pane-tabs.ts'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'
import {
  LINKED_REPO_ROOT,
  REPO_ROOT,
  USER_1,
  WORKSPACE_RUNTIME_ID,
  appRealtimeSocket,
  buildRuntime,
  createAdmittedTerminal,
  createLocalWorktreeTerminal,
  createTerminalSession,
  mockPtys,
  requestWorkspacePaneRuntime,
  requestWorkspacePaneTabs,
  sentSocketMessages,
  setMockDataToEmitOnRegistration,
  startControlledTerminalRuntime,
  workspacePaneWorktreeTarget,
} from '#/server/test-utils/terminal-runtime.ts'

describe('server terminal runtime operations', () => {
  test('serializes concurrent primary creates for the same worktree', async () => {
    const { host, shutdown } = buildRuntime()

    const first = createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    const second = createLocalWorktreeTerminal(host, 'client_b', USER_1, 'primary')

    const firstResult = await first
    expect(firstResult.ok).toBe(true)
    if (!firstResult.ok) return
    expect(firstResult.action).toBe('created')

    const secondResult = await second
    expect(secondResult.ok).toBe(true)
    if (!secondResult.ok) return
    expect(secondResult.action).toBe('reused')
    expect(secondResult.terminalSessionId).toBe(firstResult.terminalSessionId)
    expect(secondResult.terminalRuntimeSessionId).toBe(firstResult.terminalRuntimeSessionId)
    expect(mockPtys).toHaveLength(0)

    shutdown()
  })

  test('reopening a prepared terminal preserves its unbound state until attach', async () => {
    const { host, shutdown } = buildRuntime()
    const browserSocket = appRealtimeSocket()
    host.registerSocket('client_browser', USER_1, browserSocket)

    const first = await createLocalWorktreeTerminal(host, 'client_browser', USER_1, 'primary')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first).toMatchObject({ controller: null, terminalRuntimeGeneration: 0, canonicalSize: null })

    host.unregisterSocket('client_browser', USER_1, browserSocket)

    const electronSocket = appRealtimeSocket()
    host.registerSocket('client_electron', USER_1, electronSocket)

    const reopened = await createLocalWorktreeTerminal(host, 'client_electron', USER_1, 'primary')
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.action).toBe('reused')
    expect(reopened.terminalSessionId).toBe(first.terminalSessionId)
    expect(reopened).toMatchObject({ controller: null, terminalRuntimeGeneration: 0, canonicalSize: null })
    await expect(
      host.attach('client_electron', USER_1, {
        terminalRuntimeSessionId: reopened.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        cols: 102,
        rows: 33,
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream', canonicalSize: { cols: 102, rows: 33 } })

    const sessions = await host.listSessions('client_electron', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalSessionId: first.terminalSessionId,
        controller: { clientId: 'client_electron', status: 'connected' },
        canonicalSize: { cols: 102, rows: 33 },
      }),
    ])

    host.unregisterSocket('client_electron', USER_1, electronSocket)
    shutdown()
  })

  test('a failed first attach keeps the prepared session addressable for retry', async () => {
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty spawn failed')
    })
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)
    socket.send.mockClear()

    const failed = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(failed.ok).toBe(true)
    if (!failed.ok) return
    const failedAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId: failed.terminalRuntimeSessionId,
      terminalRuntimeGeneration: 0,
      cols: 80,
      rows: 24,
    })
    expect(failedAttach).toEqual({ ok: false, message: 'pty spawn failed' })

    // Process creation failure is lifecycle state on the logical session;
    // the durable tab remains addressable so an explicit retry can recover.
    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: failed.terminalRuntimeSessionId,
        phase: 'error',
        message: 'pty spawn failed',
      }),
    ])
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 1 },
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 2 },
    ])

    // A never-spawned session has no exit event — lock in that
    // semantic so we don't regress to broadcasting a phantom exit.
    const exitBroadcasts = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'exit')
    expect(exitBroadcasts).toEqual([])

    // Reopening reuses the same logical session; the next attach owns the
    // next process attempt.
    const retried = await createLocalWorktreeTerminal(host, 'client_a', USER_1, 'primary')
    expect(retried.ok).toBe(true)
    if (retried.ok) {
      expect(retried.action).toBe('reused')
      expect(retried.terminalRuntimeSessionId).toBe(failed.terminalRuntimeSessionId)
      await expect(
        host.attach('client_a', USER_1, {
          terminalRuntimeSessionId: retried.terminalRuntimeSessionId,
          terminalRuntimeGeneration: 0,
          cols: 80,
          rows: 24,
        }),
      ).resolves.toMatchObject({ ok: true, frame: 'stream' })
    }

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a failed restart keeps the session visible as error state', async () => {
    const { host, shutdown, socket, terminalRuntimeSessionId } = await startControlledTerminalRuntime()

    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })

    const restarted = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(restarted.ok).toBe(false)
    if (restarted.ok) return
    expect(restarted.message).toBe('pty restart failed')

    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        phase: 'error',
        message: 'pty restart failed',
        terminalRuntimeGeneration: 1,
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a successful restart establishes a fresh generation as a stream frame', async () => {
    const { host, shutdown, socket, terminalRuntimeSessionId } = await startControlledTerminalRuntime()

    const restarted = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })

    expect(restarted).toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 2,
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(restarted).not.toHaveProperty('snapshot')
    expect(mockPtys).toHaveLength(2)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a viewer cannot restart a session it does not control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')

    const restarted = await host.restart('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(restarted.ok).toBe(false)
    if (restarted.ok) return
    expect(restarted.message).toBe('error.invalid-arguments')

    // Stored controller intent still points at `client_a`, and `client_a`
    // is the effective controller; a subsequent restart from that client
    // must pass the authority check (here it fails later at spawn).
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })
    const retry = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 100,
      rows: 30,
    })
    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.message).toBe('pty restart failed')

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('runtime-open returns prepared terminal metadata and canonical tabs without starting a PTY', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socket)
    setMockDataToEmitOnRegistration('during-runtime-open')

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_runtime_open',
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        input: {
          runtimeType: 'terminal',
          insertAfterIdentity: 'workspace-pane:status',
          request: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
            kind: 'primary',
          },
        },
      }),
    )

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some(
          (message) => message.type === 'response' && message.requestId === 'req_runtime_open',
        ),
      ).toBe(true)
    })

    const messages = sentSocketMessages(socket)
    const responseIndex = messages.findIndex(
      (message) => message.type === 'response' && message.requestId === 'req_runtime_open',
    )
    expect(messages[responseIndex]).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      payload: {
        ok: true,
        runtimeType: 'terminal',
        runtime: {
          ok: true,
          action: 'created',
          controller: null,
          terminalRuntimeGeneration: 0,
          canonicalSize: null,
        },
      },
    })
    expect(mockPtys).toHaveLength(0)
    expect(messages.filter((message) => message.type === 'output')).toHaveLength(0)
    const firstRealtimeIndex = messages.findIndex(
      (message) => message.type === 'sessions-changed' || message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
    )
    expect(firstRealtimeIndex).toBeGreaterThan(responseIndex)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('runtime-close resolves durable terminal identity on the server and returns a canonical snapshot', async () => {
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
      'req_runtime_open_before_close',
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        {
          runtimeType: 'terminal',
          sessionId: opened.runtime.terminalSessionId,
          target: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          },
        },
        'req_runtime_close',
      ),
    ).resolves.toMatchObject({
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: 'closed',
        terminalSessionId: opened.runtime.terminalSessionId,
        terminalRuntimeSessionId: opened.runtime.terminalRuntimeSessionId,
      },
    })
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        {
          runtimeType: 'terminal',
          sessionId: opened.runtime.terminalSessionId,
          target: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          },
        },
        'req_runtime_close_again',
      ),
    ).resolves.toMatchObject({
      ok: true,
      runtime: {
        action: 'already-closed',
        terminalSessionId: opened.runtime.terminalSessionId,
      },
    })
    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('does not acknowledge runtime close before the canonical tabs snapshot is ready', async () => {
    const reconcileStarted = Promise.withResolvers<void>()
    const finishReconcile = Promise.withResolvers<void>()
    let blockReconcile = false
    const captureTargets: WorkspacePaneTargetProjectionProvider['captureTargets'] = async (
      _userId,
      workspaceId,
      scope,
    ) => {
      if (blockReconcile) {
        reconcileStarted.resolve()
        await finishReconcile.promise
      }
      return [
        {
          target: {
            kind: 'git-worktree',
            workspaceId,
            workspaceRuntimeId: scope.slice(scope.lastIndexOf('\0') + 1),
            root: LINKED_REPO_ROOT,
          },
          nativeWorktreePath: '/repo-linked',
          canonicalBranch: 'feature',
        },
      ]
    }
    const { host, shutdown } = buildRuntime({ captureTargets })
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
      'req_runtime_open_before_close_snapshot',
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    blockReconcile = true
    const closeRequest = requestWorkspacePaneTabs(
      host,
      socket,
      WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
      {
        runtimeType: 'terminal',
        sessionId: opened.runtime.terminalSessionId,
        target: { target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID) },
      },
      'req_runtime_close_waits_for_snapshot',
    )
    await reconcileStarted.promise
    expect(
      sentSocketMessages(socket).some(
        (message) => message.type === 'response' && message.requestId === 'req_runtime_close_waits_for_snapshot',
      ),
    ).toBe(false)

    finishReconcile.resolve()
    await expect(closeRequest).resolves.toMatchObject({
      ok: true,
      runtime: { action: 'closed', terminalSessionId: opened.runtime.terminalSessionId },
      paneTabsSnapshot: { entries: [] },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await createAdmittedTerminal(host, 'client_with_$pecial!chars' as never, USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
    })
    expect(result.ok).toBe(false)
    shutdown()
  })

  test('takeover returns authoritative controller snapshot from the server', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')
    host.registerSocket('client_b', USER_1, socketB)

    const result = await host.takeover('client_b', USER_1, {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      cols: 120,
      rows: 40,
    })

    expect(result).toEqual({
      ok: true,
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      identityRevision: 2,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalSize: { cols: 120, rows: 40 },
      phase: 'open',
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(120, 40)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('realtime takeover injects the socket clientId so viewer tabs can take control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = appRealtimeSocket()
    const socketB = appRealtimeSocket()
    host.registerSocket('client_a', USER_1, socketA)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')
    host.registerSocket('client_b', USER_1, socketB)
    socketB.send.mockClear()

    host.handleRealtimeMessage(
      'client_b',
      USER_1,
      socketB,
      JSON.stringify({
        type: 'request',
        requestId: 'req_takeover',
        action: 'takeover',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 120, rows: 40 },
      }),
    )

    await vi.waitFor(() => {
      expect(socketB.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
    })

    const response = socketB.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'response' && message.requestId === 'req_takeover')
    expect(response).toMatchObject({
      type: 'response',
      requestId: 'req_takeover',
      ok: true,
      action: 'takeover',
      payload: {
        ok: true,
        terminalRuntimeSessionId,
        controller: { clientId: 'client_b', status: 'connected' },
      },
    })
    const messages = socketB.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex(
      (message) => message.type === 'response' && message.requestId === 'req_takeover',
    )
    const identityIndex = messages.findIndex(
      (message) => message.type === 'identity' && message.event.terminalRuntimeSessionId === terminalRuntimeSessionId,
    )
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(identityIndex).toBeGreaterThan(responseIndex)
    expect(messages[identityIndex]).toMatchObject({
      event: {
        terminalRuntimeSessionId,
        controller: { clientId: 'client_b', status: 'connected' },
        canonicalSize: { cols: 120, rows: 40 },
      },
    })

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })
})
