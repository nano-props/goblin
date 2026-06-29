// Server-side terminal runtime integration tests.
//
// The lower-level modules (session-manager, controller, render-state,
// broker, catalog) carry their own focused unit tests. This file
// exercises `createServerTerminalRuntime` end-to-end through its
// `ServerTerminalHost` surface so the wiring between the supervisor,
// manager, broker, and catalog stays in lockstep with the shared
// protocol types in `shared/terminal-types.ts`.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import { HEARTBEAT_DEADLINE_MS, HEARTBEAT_INTERVAL_MS } from '#/server/terminal/terminal-realtime-broker.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

// Under method 2 the host threads `userId` (derived from the
// access token) alongside `clientId` (per-tab routing). Tests use
// a fixed value so the assertions don't have to mock the
// derivation helper.
const USER_1 = 'user_terminal_runtime'
const USER_2 = 'user_terminal_runtime_second'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => [{ path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false }]),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: vi.fn(async () => ({
    target: {
      id: 'ssh-config://prod/srv/repo',
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
  })),
}))

const mockPtys: Array<{
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: () => void
}> = []

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let onData: ((data: string) => void) | null = null
    let onExit: (() => void) | null = null
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data: string) => onData?.(data),
      emitExit: () => onExit?.(),
      get process() {
        return 'zsh'
      },
    }
    mockPtys.push(pty)
    return {
      ...pty,
      onData: (cb: (data: string) => void) => {
        onData = cb
        return {
          dispose: vi.fn(() => {
            if (onData === cb) onData = null
          }),
        }
      },
      onExit: (cb: () => void) => {
        onExit = cb
        return {
          dispose: vi.fn(() => {
            if (onExit === cb) onExit = null
          }),
        }
      },
    }
  }),
}))

interface RuntimeHandle {
  host: ServerTerminalHost
  shutdown: () => void
  isClientConnected: (clientId: string) => boolean
}

function buildRuntime(): RuntimeHandle {
  const runtime = createServerTerminalRuntime({ ptySupervisor: createInProcessPtySupervisor() })
  return {
    host: runtime.host,
    shutdown: () => runtime.shutdown(),
    isClientConnected: (clientId: string) => runtime.host.isClientConnected(USER_1, clientId),
  }
}

beforeEach(() => {
  vi.useRealTimers()
  mockPtys.length = 0
  vi.clearAllMocks()
})

async function createTerminalSession(host: ServerTerminalHost, clientId: string, userId = USER_1): Promise<string> {
  const result = await host.create(clientId, userId, {
    repoRoot: '/repo',
    branch: 'feature',
    worktreePath: '/repo-linked',
    kind: 'additional',
    cols: 80,
    rows: 24,
    ...(clientId ? { clientId } : {}),
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.sessions[0]?.ptySessionId ?? ''
}

describe('server terminal runtime', () => {
  test('create claims controller control for the provided attachment', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const result = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sessions).toEqual([
      expect.objectContaining({
        key: result.key,
        controller: { clientId: 'client_a', status: 'connected' },
        phase: 'opening',
        message: null,
        cols: 80,
        rows: 24,
      }),
    ])
    const ptySessionId = result.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')

    mockPtys[0]?.emitData('ready')

    await expect(host.listSessions('client_a', USER_1, '/repo')).resolves.toEqual([
      expect.objectContaining({
        ptySessionId,
        phase: 'open',
        message: null,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a second attachment can attach as viewer without stealing controller control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)

    const createResult = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const ptySessionId = createResult.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')

    const attachResult = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(attachResult).toMatchObject({
      ok: true,
      ptySessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalCols: 80,
      canonicalRows: 24,
    })

    const sessions = await host.listSessions('client_a', USER_1, '/repo')
    expect(sessions).toEqual([
      expect.objectContaining({
        ptySessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('replay snapshots omit a leading zsh prompt end marker prelude', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_1')
    const prompt =
      '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J👾:~/repo\r\n$ '
    mockPtys[0]?.emitData(prompt)

    const attach = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    const snapshot = await host.getSessionSnapshot('client_1', USER_1, { ptySessionId })

    expect(attach.ok).toBe(true)
    if (!attach.ok) return
    expect(attach.snapshot).toBe('👾:~/repo\r\n$ ')
    expect(snapshot?.snapshot).toBe('👾:~/repo\r\n$ ')
    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reattaching after a disconnect auto-reclaims control and canonical geometry', async () => {
    // The previous revision had a 30s grace sub-state that kept the
    // controller role occupied between disconnect and reconnect. The
    // current model clears the controller role on disconnect (no grace) and
    // treats a reconnect as a fresh attach — for a session that has
    // already been claimed by the user (userSticky=true), the
    // reattach auto-claims.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)

    const createResult = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const ptySessionId = createResult.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')

    host.unregisterSocket('client_a', USER_1, socketA)
    const socketA2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA2)

    const reattachResult = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 101,
      rows: 31,
      clientId: 'client_a',
    })
    expect(reattachResult).toMatchObject({
      ok: true,
      ptySessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalCols: 101,
      canonicalRows: 31,
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    const sessions = await host.listSessions('client_a', USER_1, '/repo')
    expect(sessions).toEqual([
      expect.objectContaining({
        ptySessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        cols: 101,
        rows: 31,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA2)
    shutdown()
  })

  test('realtime attach injects the socket clientId and resizes an owned session to the live terminal size', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const createResult = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const ptySessionId = createResult.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_resize',
        action: 'attach',
        input: { ptySessionId, cols: 101, rows: 31, clientId: 'client_a' },
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
        ptySessionId,
        phase: 'opening',
        message: null,
        canonicalCols: 101,
        canonicalRows: 31,
        controller: { clientId: 'client_a', status: 'connected' },
      },
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('broadcasts output and exit events to registered web terminal sockets', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)

    mockPtys[0]?.emitData('hello')
    const outputMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'output')
    expect(outputMessage).toMatchObject({
      type: 'output',
      event: { data: 'hello', seq: 1 },
    })

    mockPtys[0]?.emitExit()
    const exitMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'exit')
    expect(exitMessage).toMatchObject({ type: 'exit' })
    expect(host.getDiagnostics().pty.state).toBe('idle')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_a', USER_1, {
      repoRoot: 'ssh-config://prod/srv/repo',
      branch: 'feature',
      worktreePath: '/srv/repo',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' })
    expect(result.sessions).toEqual([
      expect.objectContaining({
        key: 'ssh-config://prod/srv/repo\0/srv/repo\0session-1',
      }),
    ])

    shutdown()
  })

  test('reuses the existing terminal when reopening the same repo root', async () => {
    const { host, shutdown } = buildRuntime()
    const first = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.action).toBe('created')
    const second = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('reused')
    expect(second.key).toBe(first.key)

    shutdown()
  })

  test('reopening an existing terminal from a new attachment auto-reclaims user-sticky control', async () => {
    const { host, shutdown } = buildRuntime()
    const browserSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_browser', USER_1, browserSocket)

    const first = await host.create('client_browser', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_browser',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.controller).toEqual({ clientId: 'client_browser', status: 'connected' })

    host.unregisterSocket('client_browser', USER_1, browserSocket)

    const electronSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_electron', USER_1, electronSocket)

    const reopened = await host.create('client_electron', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 102,
      rows: 33,
      clientId: 'client_electron',
    })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.action).toBe('reused')
    expect(reopened.key).toBe(first.key)
    expect(reopened.controller).toEqual({ clientId: 'client_electron', status: 'connected' })
    expect(reopened.canonicalCols).toBe(102)
    expect(reopened.canonicalRows).toBe(33)
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(102, 33)

    const sessions = await host.listSessions('client_electron', USER_1, '/repo')
    expect(sessions).toEqual([
      expect.objectContaining({
        key: first.key,
        controller: { clientId: 'client_electron', status: 'connected' },
        cols: 102,
        rows: 33,
      }),
    ])

    host.unregisterSocket('client_electron', USER_1, electronSocket)
    shutdown()
  })

  test('a failed spawn removes the zombie session so the next create retries cleanly', async () => {
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty spawn failed')
    })
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    socket.send.mockClear()

    const failed = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) return

    // After the failure, listSessions must not report the zombie. If
    // it did, the catalog would match it on retry and surface a
    // blank, non-responsive terminal as a successful attach.
    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, '/repo')
    expect(sessionsAfterFailure).toEqual([])

    // A never-spawned session has no exit event — lock in that
    // semantic so we don't regress to broadcasting a phantom exit.
    const exitBroadcasts = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'exit')
    expect(exitBroadcasts).toEqual([])

    // Retry with a working spawn must succeed as a brand-new create.
    const retried = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(retried.ok).toBe(true)
    if (retried.ok) expect(retried.action).toBe('created')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a failed restart keeps the session visible as error state', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_a')

    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })

    const restarted = await host.restart('client_a', USER_1, {
      ptySessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(restarted.ok).toBe(false)
    if (restarted.ok) return
    expect(restarted.message).toBe('pty restart failed')

    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, '/repo')
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        ptySessionId,
        phase: 'error',
        message: 'pty restart failed',
        cols: 100,
        rows: 30,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a viewer cannot restart a session it does not control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const ptySessionId = await createTerminalSession(host, 'client_1')

    const restarted = await host.restart('client_a', USER_1, {
      ptySessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_b',
    })
    expect(restarted.ok).toBe(false)
    if (!restarted.ok) return
    expect(restarted.message).toBe('error.not-controller')

    // The session is still owned by attachment_a; a subsequent restart
    // from the real controller must succeed (here it would fail at
    // spawn, but only after passing the authority check).
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })
    const retry = await host.restart('client_a', USER_1, {
      ptySessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.message).toBe('pty restart failed')

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('sends attach response before flushing buffered output emitted during the attach request', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach',
        action: 'attach',
        input: { ptySessionId, cols: 80, rows: 24 },
      }),
    )
    mockPtys[0]?.emitData('during-attach')

    await vi.waitFor(() => {
      expect(socket.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
      expect(socket.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'output')).toBe(true)
    })

    const messages = socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex((message) => message.type === 'response')
    const outputIndex = messages.findIndex((message) => message.type === 'output')
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(outputIndex).toBeGreaterThan(responseIndex)
    expect(messages[responseIndex]).toMatchObject({
      type: 'response',
      requestId: 'req_attach',
      ok: true,
      action: 'attach',
    })
    expect(messages[outputIndex]).toMatchObject({
      type: 'output',
      event: { ptySessionId, data: 'during-attach', seq: 1 },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('realtime create returns snapshot hydration fields in its response payload', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    host.handleRealtimeMessage(
      'client_1',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_create',
        action: 'create',
        input: {
          repoRoot: '/repo',
          branch: 'feature',
          worktreePath: '/repo-linked',
          kind: 'primary',
          cols: 80,
          rows: 24,
        },
      }),
    )

    await vi.waitFor(() => {
      expect(
        socket.send.mock.calls.some(([payload]) => {
          const message = JSON.parse(String(payload))
          return message.type === 'response' && message.requestId === 'req_create'
        }),
      ).toBe(true)
    })

    const response = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'response' && message.requestId === 'req_create')
    expect(response).toMatchObject({
      type: 'response',
      requestId: 'req_create',
      ok: true,
      action: 'create',
      payload: {
        ok: true,
        action: 'created',
        ptySessionId: expect.any(String),
        processName: 'zsh',
        snapshot: expect.any(String),
        snapshotSeq: expect.any(Number),
        canonicalCols: 80,
        canonicalRows: 24,
      },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_with_$pecial!chars' as never, USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(result.ok).toBe(false)
    shutdown()
  })

  test('takeover returns authoritative controller snapshot from the server', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const ptySessionId = await createTerminalSession(host, 'client_1')
    host.registerSocket('client_b', USER_1, socketB)

    const result = host.takeover('client_a', USER_1, {
      ptySessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })

    expect(result).toEqual({
      ok: true,
      ptySessionId,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
      phase: 'opening',
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(120, 40)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('realtime takeover injects the socket clientId so viewer tabs can take control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const ptySessionId = await createTerminalSession(host, 'client_a')
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
        input: { ptySessionId, cols: 120, rows: 40, clientId: 'client_b' },
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
        ptySessionId,
        controller: { clientId: 'client_b', status: 'connected' },
      },
    })
    const messages = socketB.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex(
      (message) => message.type === 'response' && message.requestId === 'req_takeover',
    )
    const identityIndex = messages.findIndex(
      (message) => message.type === 'identity' && message.event.ptySessionId === ptySessionId,
    )
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(identityIndex).toBeGreaterThan(responseIndex)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('lists repo sessions across clients sharing a userId and broadcasts lifecycle invalidations to that user', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client2_b', USER_1, socketB)
    const ptySessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)

    const sessions = await host.listSessions('client_2', USER_1, '/repo')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.ptySessionId).toBe(ptySessionId)

    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client2_b', USER_1, socketB)
    shutdown()
  })

  test('isolates terminal catalog reads and lifecycle broadcasts by userId', async () => {
    const { host, shutdown } = buildRuntime()
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_shared_attachment_a', USER_1, userASocket)
    host.registerSocket('client_shared_attachment_b', USER_2, userBSocket)

    const userACreate = await host.create('client_shared', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(userACreate.ok).toBe(true)
    if (!userACreate.ok) return
    const userASession = userACreate.sessions[0]
    if (!userASession) throw new Error('expected user A session')

    expect(await host.listSessions('client_shared', USER_2, '/repo')).toEqual([])
    await expect(
      host.getSessionSnapshot('client_shared', USER_2, { ptySessionId: userASession.ptySessionId }),
    ).resolves.toBeNull()
    expect(host.close('client_shared', USER_2, { ptySessionId: userASession.ptySessionId })).toBe(false)
    expect(
      userBSocket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(false)

    const userBCreate = await host.create('client_shared', USER_2, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 100,
      rows: 30,
      clientId: 'client_b',
    })
    expect(userBCreate.ok).toBe(true)
    if (!userBCreate.ok) return
    const userBSession = userBCreate.sessions[0]
    if (!userBSession) throw new Error('expected user B session')

    expect(userBSession.key).toBe(userASession.key)
    expect(userBSession.ptySessionId).not.toBe(userASession.ptySessionId)
    expect(await host.listSessions('client_shared', USER_1, '/repo')).toEqual([
      expect.objectContaining({ ptySessionId: userASession.ptySessionId, key: userASession.key }),
    ])
    expect(await host.listSessions('client_shared', USER_2, '/repo')).toEqual([
      expect.objectContaining({ ptySessionId: userBSession.ptySessionId, key: userBSession.key }),
    ])

    host.unregisterSocket('client_shared_attachment_a', USER_1, userASocket)
    host.unregisterSocket('client_shared_attachment_b', USER_2, userBSocket)
    shutdown()
  })

  test('cleans up disconnected sessions after the reconnect grace period elapses', async () => {
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_1')

    const first = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(first.ok).toBe(true)
    expect(mockPtys).toHaveLength(1)

    host.unregisterSocket('client_a', USER_1, socket)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_b', USER_1, socket2)
    const recreatedSessionId = await createTerminalSession(host, 'client_1')
    const replacementAttach = await host.attach('client_a', USER_1, {
      ptySessionId: recreatedSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_b',
    })
    expect(replacementAttach.ok).toBe(true)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.ptySessionId).not.toBe(first.ptySessionId)

    host.unregisterSocket('client_b', USER_1, socket2)
    shutdown()
  })

  test('after the controller disconnects, a sibling attachment auto-claims on attach (single-user)', async () => {
    // Device-switch scenario in the new model: A was the controller
    // (from create); A's socket closes; B (a different clientId)
    // attaches. The previous revision refused the auto-claim because
    // the controller role was still in the 30s grace sub-state. The current
    // model clears the controller role on disconnect, so B's attach auto-claims.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const ptySessionId = created.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')

    host.unregisterSocket('client_a', USER_1, socketA)

    // B comes online and attaches — no explicit takeover needed
    // because the controller role was cleared on A's disconnect.
    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(viewerAttach).toMatchObject({
      ok: true,
      ptySessionId,
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
    })

    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('a late-returning original controller stays a viewer once a sibling has claimed control (no grace restore)', async () => {
    // The new user-sticky model clears the controller role on
    // disconnect with no grace period. If a sibling attachment
    // attaches in the window before the original controller
    // reconnects, the sibling claims control. When the original
    // controller eventually reconnects, it is a viewer — the
    // previous design's grace restore ("same clientId keeps
    // control after a brief disconnect") does not apply. The
    // design-doc rule that wins here is "most recent write intent
    // wins" — the sibling's attach is the more recent intent.
    //
    // The client's AuthorityGate handles the recovery path: a
    // write from the late-returning attachment triggers a takeover
    // round-trip (asserted in the authority-gate tests). This
    // runtime test pins down the server-side state after the
    // reconnect so the contract is explicit.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    const socketAReconnect = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const ptySessionId = created.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')
    mockPtys[0]?.emitData('ready')

    // A disconnects; B attaches and claims the now-empty controller role.
    host.unregisterSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const bAttach = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(bAttach).toMatchObject({
      ok: true,
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // A reconnects later. B still holds the controller role; A's attach must
    // NOT preempt B — A becomes a viewer.
    host.registerSocket('client_a', USER_1, socketAReconnect)
    const aReattach = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(aReattach).toMatchObject({
      ok: true,
      ptySessionId,
      // A's view sees B still in control.
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // And A's write is rejected — server-side authority check fails
    // with not-controller. The client-side AuthorityGate catches
    // this and fires a takeover before retrying; this test pins the
    // server invariant.
    const aWrite = host.write('client_a', USER_1, {
      ptySessionId,
      data: 'ls\n',
      clientId: 'client_a',
    })
    expect(aWrite).toBe(false)

    // B's write still works.
    const bWrite = host.write('client_a', USER_1, {
      ptySessionId,
      data: 'pwd\n',
      clientId: 'client_b',
    })
    expect(bWrite).toBe(true)
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    // listSessions confirms the global view: B is the controller,
    // canonical geometry follows B (the most recent writer).
    const sessions = await host.listSessions('client_a', USER_1, '/repo')
    expect(sessions).toEqual([
      expect.objectContaining({
        ptySessionId,
        controller: { clientId: 'client_b', status: 'connected' },
        cols: 120,
        rows: 40,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketAReconnect)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('disconnecting a viewer leaves the current controller unchanged', async () => {
    // The previous revision had a grace sub-state that, on expiry,
    // would remove the disconnected viewer via `expireAttachment`.
    // The current model has no per-attachment grace — only the
    // detached TTL fires (after 24h), which is far longer than the
    // test. The relevant invariant is that disconnecting a viewer
    // doesn't disturb the controller.
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await host.create('client_a', USER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const ptySessionId = created.sessions[0]?.ptySessionId
    if (!ptySessionId) throw new Error('expected session id')

    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(viewerAttach.ok).toBe(true)

    host.unregisterSocket('client_b', USER_1, socketB)
    // The detached TTL is 24h — far longer than any grace we used
    // to have. Run a small tick to flush the socket-disconnect
    // microtask without firing any timer.
    await Promise.resolve()

    const sessionsAfterExpiry = await host.listSessions('client_a', USER_1, '/repo')
    expect(sessionsAfterExpiry).toEqual([
      expect.objectContaining({
        ptySessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA)
    shutdown()
  })

  test('batches rapid writes into a single ordered pty write via the input queue', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_1')
    mockPtys[0]?.emitData('ready')

    const attach = await host.attach('client_a', USER_1, {
      ptySessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(attach.ok).toBe(true)

    host.write('client_a', USER_1, { ptySessionId, data: 'c', clientId: 'client_a' })
    host.write('client_a', USER_1, { ptySessionId, data: 'l', clientId: 'client_a' })
    host.write('client_a', USER_1, { ptySessionId, data: 'e', clientId: 'client_a' })
    host.write('client_a', USER_1, { ptySessionId, data: 'a', clientId: 'client_a' })
    host.write('client_a', USER_1, { ptySessionId, data: 'r', clientId: 'client_a' })

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('exposes a closing-state supervisor after shutdown', async () => {
    const { host, shutdown } = buildRuntime()
    expect(host.getDiagnostics().shuttingDown).toBe(false)
    shutdown()
    expect(host.getDiagnostics().shuttingDown).toBe(true)
  })

  test('emits an identity change when a takeover succeeds', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const ptySessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    const result = await host.takeover('client_a', USER_1, {
      ptySessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const identityMessages = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'identity')
    expect(identityMessages.length).toBeGreaterThan(0)
    expect(identityMessages.at(-1)).toMatchObject({
      event: {
        ptySessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
      },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('T4.1: getDiagnostics exposes aggregate live session count and ring buffer stats', async () => {
    const { host, shutdown } = buildRuntime()
    try {
      // Empty runtime: no sessions, no buffers.
      let stats = host.getDiagnostics()
      expect(stats.liveSessionCount).toBe(0)
      expect(stats.totalRingBufferChars).toBe(0)
      expect(stats.maxRingBufferChars).toBe(0)

      // Create two sessions; their buffers start empty.
      const sessionA = await createTerminalSession(host, 'client_1')
      const sessionB = await createTerminalSession(host, 'client_1')
      stats = host.getDiagnostics()
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(0)
      expect(stats.maxRingBufferChars).toBe(0)

      // Emit data into the first session's PTY. The manager's
      // onOutput sink routes through broker.broadcast but also
      // appends to the per-session render buffer, which is what
      // the new diagnostic fields measure.
      mockPtys[0]?.emitData('aaaaa')
      stats = host.getDiagnostics()
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(5)
      expect(stats.maxRingBufferChars).toBe(5)

      // Emit more data into the second session. The max should
      // track the larger of the two; the total should sum both.
      mockPtys[1]?.emitData('bbbbbbbbbb')
      stats = host.getDiagnostics()
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(15)
      expect(stats.maxRingBufferChars).toBe(10)

      // The sessionA / sessionB identifiers are unused here — the
      // assertion is on aggregate state, not on which mock PTY
      // was which. Reference them so the linter doesn't complain
      // about unused locals.
      expect([sessionA, sessionB]).toHaveLength(2)
    } finally {
      shutdown()
    }
  })

  test('runtime routes a heartbeat envelope to the broker with the right (userId, clientId, at) triple', async () => {
    // Regression guard for the
    // `broker.recordHeartbeat(clientId, userId, at)` arg-order bug
    // that the original implementation shipped. The broker keys
    // on `userClientKey(userId, clientId)`, so a swapped call
    // silently misses every live heartbeat — the deadline scan
    // then prematurely fires `onClientDisconnected` for healthy
    // controllers. The broker unit tests passed because they
    // call the broker directly with the right order; this test
    // covers the wiring through the runtime's `handleRealtimeMessage`.
    //
    // The assertion is end-to-end: after a real heartbeat has been
    // routed through the runtime, advancing the fake clock past
    // the original deadline must NOT clear the registered socket
    // — only a heartbeat routed with the correct (userId, clientId)
    // order resets the broker's deadline clock.
    const { host, shutdown, isClientConnected } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-24T00:00:00Z'))

      // First heartbeat at t=0.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat', at: Date.now() }))
      // Advance just shy of the original deadline.
      vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS - 1_000)
      // Heartbeat again — this MUST use the right (userId, clientId, at)
      // order, otherwise the broker's clock never updates and the
      // very next scan would synthesize a disconnect.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat', at: Date.now() }))
      // Advance past the original 90 s deadline. A correctly routed
      // heartbeat (a real client sending every 30 s) means the
      // broker clock is fresh, so the synthetic disconnect must NOT
      // fire and the registered socket must still be connected.
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      expect(isClientConnected('client_a')).toBe(true)
    } finally {
      vi.useRealTimers()
      shutdown()
    }
  })

  test('runtime: a silent client (no heartbeats) is synthetically disconnected past the deadline', async () => {
    // Companion to the previous test: the previous one asserts a
    // chatty client survives the deadline; this one asserts a
    // silent client is dropped. End-to-end through the runtime:
    // `registerSocket` only, no `handleRealtimeMessage` calls,
    // advance past `HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS`,
    // and assert `host.isClientConnected` flips to `false`.
    //
    // The fake timers must be installed BEFORE `buildRuntime()`,
    // because the broker's `setInterval` is created in its
    // constructor; a real setInterval created before
    // `vi.useFakeTimers()` is not driven by fake time.
    vi.useFakeTimers()
    let host: ReturnType<typeof buildRuntime>['host'] | undefined
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(new Date('2026-06-24T00:00:00Z'))
      const handle = buildRuntime()
      host = handle.host
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_silent', USER_1, socket)

      // `registerSocket` seeds the heartbeat clock to `Date.now()`
      // (t=0). The broker's own `setInterval` fires every
      // `HEARTBEAT_INTERVAL_MS` (30 s); the scan at t=120 s sees
      // the client as stale and fires the synthetic disconnect.
      vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS)

      // The socket is still registered (the OS hasn't closed it),
      // but the broker clock has aged out, so the host reports
      // disconnected. This is the new `isClientConnected`
      // semantics — see `terminal-realtime-broker.ts:143-160`.
      expect(handle.isClientConnected('client_silent')).toBe(false)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })
})
