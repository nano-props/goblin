// Server-side terminal runtime integration tests.
//
// The lower-level modules (session-manager, ownership, render-state,
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
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

// Under method 2 the host threads `ownerId` (derived from the
// access token) alongside `clientId` (per-tab routing). Tests use
// a fixed value so the assertions don't have to mock the
// derivation helper.
const OWNER_1 = 'owner_terminal_runtime'
const OWNER_2 = 'owner_terminal_runtime_second'

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
}

function buildRuntime(): RuntimeHandle {
  const runtime = createServerTerminalRuntime({ ptySupervisor: createInProcessPtySupervisor() })
  return { host: runtime.host, shutdown: () => runtime.shutdown() }
}

beforeEach(() => {
  vi.useRealTimers()
  mockPtys.length = 0
  vi.clearAllMocks()
})

async function createTerminalSession(
  host: ServerTerminalHost,
  clientId: string,
  attachmentId?: string,
  ownerId = OWNER_1,
): Promise<string> {
  const result = await host.create(clientId, ownerId, {
    repoRoot: '/repo',
    branch: 'feature',
    worktreePath: '/repo-linked',
    kind: 'additional',
    cols: 80,
    rows: 24,
    ...(attachmentId ? { attachmentId } : {}),
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.sessions[0]?.sessionId ?? ''
}

describe('server terminal runtime', () => {
  test('create claims controller ownership for the provided attachment', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)

    const result = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sessions).toEqual([
      expect.objectContaining({
        key: result.key,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('a second attachment can attach as viewer without stealing controller ownership', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.registerSocket('client_1', 'attachment_b', OWNER_1, socketB)

    const createResult = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const sessionId = createResult.sessions[0]?.sessionId
    if (!sessionId) throw new Error('expected session id')

    const attachResult = await host.attach('client_1', OWNER_1, {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })
    expect(attachResult).toMatchObject({
      ok: true,
      sessionId,
      controller: { attachmentId: 'attachment_a', status: 'connected' },
      canonicalCols: 80,
      canonicalRows: 24,
    })

    const sessions = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socketB)
    shutdown()
  })

  test('replay snapshots omit a leading zsh prompt end marker prelude', async () => {
    const { host, shutdown } = buildRuntime()
    const sessionId = await createTerminalSession(host, 'client_1')
    const prompt =
      '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J👾:~/repo\r\n$ '
    mockPtys[0]?.emitData(prompt)

    const attach = await host.attach('client_1', OWNER_1, { sessionId, cols: 80, rows: 24 })
    const snapshot = await host.getSessionSnapshot('client_1', OWNER_1, { sessionId })

    expect(attach.ok).toBe(true)
    if (!attach.ok) return
    expect(attach.snapshot).toBe('👾:~/repo\r\n$ ')
    expect(snapshot?.snapshot).toBe('👾:~/repo\r\n$ ')
    shutdown()
  })

  test('reattaching the grace controller restores connected ownership and canonical geometry', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)

    const createResult = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const sessionId = createResult.sessions[0]?.sessionId
    if (!sessionId) throw new Error('expected session id')

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    // The grace period is 30s; re-register a fresh socket before
    // the reattach so the broker check (Bug B fix) sees the
    // attachment as connected. The old stub always returned `true`
    // for any attachmentId; method 2 makes the broker the source
    // of truth, so a live socket is required.
    const socketA2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA2)

    const reattachResult = await host.attach('client_1', OWNER_1, {
      sessionId,
      cols: 101,
      rows: 31,
      attachmentId: 'attachment_a',
    })
    expect(reattachResult).toMatchObject({
      ok: true,
      sessionId,
      controller: { attachmentId: 'attachment_a', status: 'connected' },
      canonicalCols: 101,
      canonicalRows: 31,
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    const sessions = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        cols: 101,
        rows: 31,
      }),
    ])

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA2)
    shutdown()
  })

  test('realtime attach injects the socket attachmentId and resizes an owned session to the live terminal size', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)

    const createResult = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const sessionId = createResult.sessions[0]?.sessionId
    if (!sessionId) throw new Error('expected session id')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      'attachment_a',
      OWNER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_resize',
        action: 'attach',
        input: { sessionId, cols: 101, rows: 31 },
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
        sessionId,
        phase: 'open',
        message: null,
        canonicalCols: 101,
        canonicalRows: 31,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
      },
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('broadcasts output and exit events to registered web terminal sockets', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    const sessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_1', OWNER_1, { sessionId, cols: 80, rows: 24 })
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

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_1', OWNER_1, {
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
        key: 'ssh-config://prod/srv/repo\0/srv/repo\0terminal-1',
      }),
    ])

    shutdown()
  })

  test('reuses the existing terminal when reopening the same repo root', async () => {
    const { host, shutdown } = buildRuntime()
    const first = await host.create('client_1', OWNER_1, {
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
    const second = await host.create('client_1', OWNER_1, {
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

  test('a failed spawn removes the zombie session so the next create retries cleanly', async () => {
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty spawn failed')
    })
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    socket.send.mockClear()

    const failed = await host.create('client_1', OWNER_1, {
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
    const sessionsAfterFailure = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsAfterFailure).toEqual([])

    // A never-spawned session has no exit event — lock in that
    // semantic so we don't regress to broadcasting a phantom exit.
    const exitBroadcasts = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'exit')
    expect(exitBroadcasts).toEqual([])

    // Retry with a working spawn must succeed as a brand-new create.
    const retried = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(retried.ok).toBe(true)
    if (retried.ok) expect(retried.action).toBe('created')

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('a failed restart keeps the session visible as error state', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    const sessionId = await createTerminalSession(host, 'client_1', 'attachment_a')

    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })

    const restarted = await host.restart('client_1', OWNER_1, {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_a',
    })
    expect(restarted.ok).toBe(false)
    if (restarted.ok) return
    expect(restarted.message).toBe('pty restart failed')

    const sessionsAfterFailure = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        sessionId,
        phase: 'error',
        message: 'pty restart failed',
        cols: 100,
        rows: 30,
      }),
    ])

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('a viewer cannot restart a session it does not control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.registerSocket('client_1', 'attachment_b', OWNER_1, socketB)
    const sessionId = await createTerminalSession(host, 'client_1', 'attachment_a')

    const restarted = await host.restart('client_1', OWNER_1, {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_b',
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
    const retry = await host.restart('client_1', OWNER_1, {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_a',
    })
    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.message).toBe('pty restart failed')

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socketB)
    shutdown()
  })

  test('rejects terminal reorder requests with duplicate keys', async () => {
    const { host, shutdown } = buildRuntime()
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')

    const sessionsBefore = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsBefore).toHaveLength(3)

    const result = host.reorderViews('client_1', OWNER_1, {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      orderedViews: [
        { type: 'terminal', id: sessionsBefore[0]!.key },
        { type: 'terminal', id: sessionsBefore[1]!.key },
        { type: 'terminal', id: sessionsBefore[1]!.key },
      ],
    })

    expect(result).toBe(false)
    shutdown()
  })

  test('reorders sessions and broadcasts sessions-changed when given a valid order', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')

    const sessionsBefore = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsBefore).toHaveLength(3)
    const [first, second, third] = sessionsBefore
    if (!first || !second || !third) throw new Error('expected three sessions')
    socket.send.mockClear()

    const result = host.reorderViews('client_1', OWNER_1, {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      orderedViews: [
        { type: 'terminal', id: third.key },
        { type: 'terminal', id: first.key },
        { type: 'terminal', id: second.key },
      ],
    })
    expect(result).toBe(true)

    const sessionsAfter = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsAfter.map((s) => s.key)).toEqual([third.key, first.key, second.key])

    // The broadcast fires for the repoRoot (not the normalized form).
    expect(
      socket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('rejects reorder payloads that would create unopened static views', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')

    const sessionsBefore = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsBefore).toHaveLength(2)
    const [first, second] = sessionsBefore
    if (!first || !second) throw new Error('expected two sessions')
    socket.send.mockClear()

    const invalidInput = {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      orderedViews: [
        { type: 'status', id: 'status' },
        { type: 'terminal', id: second.key },
        { type: 'terminal', id: first.key },
      ],
    } as unknown as Parameters<typeof host.reorderViews>[2]
    const result = host.reorderViews('client_1', OWNER_1, invalidInput)

    expect(result).toBe(false)
    expect(await host.listViews('client_1', OWNER_1, '/repo')).toEqual([])
    expect((await host.listSessions('client_1', OWNER_1, '/repo')).map((session) => session.key)).toEqual([
      first.key,
      second.key,
    ])
    expect(socket.send).not.toHaveBeenCalled()

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('opens and closes static views without requiring a full reorder payload', async () => {
    const { host, shutdown } = buildRuntime()
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')

    const sessions = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessions).toHaveLength(2)
    expect(await host.listViews('client_1', OWNER_1, '/repo')).toEqual([])

    const opened = host.openView('client_1', OWNER_1, {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      type: 'changes',
    })
    expect(opened).toBe(true)

    const tabs = await host.listViews('client_1', OWNER_1, '/repo')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toEqual(expect.objectContaining({ type: 'changes', id: 'changes', worktreePath: '/repo-linked' }))
    expect(tabs[0]!.displayOrder).toBeGreaterThan(Math.max(...sessions.map((session) => session.displayOrder)))

    const closed = host.closeView('client_1', OWNER_1, {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      type: 'changes',
    })
    expect(closed).toBe(true)
    expect(await host.listViews('client_1', OWNER_1, '/repo')).toEqual([])
    expect(await host.listSessions('client_1', OWNER_1, '/repo')).toHaveLength(2)

    shutdown()
  })

  test('prunes static workspace pane views for removed local worktrees', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)

    expect(
      host.openView('client_1', OWNER_1, {
        repoRoot: '/repo',
        worktreePath: '/repo-linked',
        type: 'changes',
      }),
    ).toBe(true)
    expect(
      host.openView('client_1', OWNER_1, {
        repoRoot: '/repo',
        worktreePath: '/repo-removed',
        type: 'changes',
      }),
    ).toBe(true)
    expect(await host.listViews('client_1', OWNER_1, '/repo')).toHaveLength(2)
    socket.send.mockClear()

    await expect(host.prune('client_1', OWNER_1, '/repo')).resolves.toEqual({ pruned: 0, remaining: 0 })

    expect(await host.listViews('client_1', OWNER_1, '/repo')).toEqual([
      expect.objectContaining({ type: 'changes', worktreePath: '/repo-linked' }),
    ])
    expect(socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))).toContainEqual({
      type: 'sessions-changed',
      repoRoot: '/repo',
    })

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('sends attach response before flushing buffered output emitted during the attach request', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    const sessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      'attachment_a',
      OWNER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach',
        action: 'attach',
        input: { sessionId, cols: 80, rows: 24 },
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
      event: { sessionId, data: 'during-attach', seq: 1 },
    })

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('realtime create returns snapshot hydration fields in its response payload', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)

    host.handleRealtimeMessage(
      'client_1',
      'attachment_a',
      OWNER_1,
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
        sessionId: expect.any(String),
        processName: 'zsh',
        snapshot: expect.any(String),
        snapshotSeq: expect.any(Number),
        canonicalCols: 80,
        canonicalRows: 24,
      },
    })

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_with_$pecial!chars' as never, OWNER_1, {
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

  test('takeover returns authoritative ownership snapshot from the server', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    const sessionId = await createTerminalSession(host, 'client_1')
    host.registerSocket('client_1', 'attachment_b', OWNER_1, socketB)

    const result = host.takeover('client_1', OWNER_1, {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })

    expect(result).toEqual({
      ok: true,
      sessionId,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { attachmentId: 'attachment_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
      phase: 'open',
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(120, 40)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socketB)
    shutdown()
  })

  test('realtime takeover injects the socket attachmentId so viewer tabs can take control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    const sessionId = await createTerminalSession(host, 'client_1')
    host.registerSocket('client_1', 'attachment_b', OWNER_1, socketB)
    socketB.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      'attachment_b',
      OWNER_1,
      socketB,
      JSON.stringify({
        type: 'request',
        requestId: 'req_takeover',
        action: 'takeover',
        input: { sessionId, cols: 120, rows: 40 },
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
        sessionId,
        controller: { attachmentId: 'attachment_b', status: 'connected' },
      },
    })
    const messages = socketB.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex(
      (message) => message.type === 'response' && message.requestId === 'req_takeover',
    )
    const ownershipIndex = messages.findIndex(
      (message) => message.type === 'ownership' && message.event.sessionId === sessionId,
    )
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(ownershipIndex).toBeGreaterThan(responseIndex)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socketB)
    shutdown()
  })

  test('lists repo sessions across clients sharing an owner and broadcasts lifecycle invalidations to that owner', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.registerSocket('client_2', 'attachment_b', OWNER_1, socketB)
    const sessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_1', OWNER_1, { sessionId, cols: 80, rows: 24 })
    expect(result.ok).toBe(true)

    const sessions = await host.listSessions('client_2', OWNER_1, '/repo')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe(sessionId)

    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    host.unregisterSocket('client_2', 'attachment_b', OWNER_1, socketB)
    shutdown()
  })

  test('isolates terminal catalog reads and lifecycle broadcasts by ownerId', async () => {
    const { host, shutdown } = buildRuntime()
    const ownerASocket = { send: vi.fn(), close: vi.fn() }
    const ownerBSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_shared', 'attachment_a', OWNER_1, ownerASocket)
    host.registerSocket('client_shared', 'attachment_b', OWNER_2, ownerBSocket)

    const ownerACreate = await host.create('client_shared', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(ownerACreate.ok).toBe(true)
    if (!ownerACreate.ok) return
    const ownerASession = ownerACreate.sessions[0]
    if (!ownerASession) throw new Error('expected owner A session')

    expect(await host.listSessions('client_shared', OWNER_2, '/repo')).toEqual([])
    await expect(
      host.getSessionSnapshot('client_shared', OWNER_2, { sessionId: ownerASession.sessionId }),
    ).resolves.toBeNull()
    expect(host.close('client_shared', OWNER_2, { sessionId: ownerASession.sessionId })).toBe(false)
    expect(
      host.reorderViews('client_shared', OWNER_2, {
        repoRoot: '/repo',
        worktreePath: '/repo-linked',
        orderedViews: [{ type: 'terminal', id: ownerASession.key }],
      }),
    ).toBe(false)
    expect(
      ownerBSocket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(false)

    const ownerBCreate = await host.create('client_shared', OWNER_2, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_b',
    })
    expect(ownerBCreate.ok).toBe(true)
    if (!ownerBCreate.ok) return
    const ownerBSession = ownerBCreate.sessions[0]
    if (!ownerBSession) throw new Error('expected owner B session')

    expect(ownerBSession.key).toBe(ownerASession.key)
    expect(ownerBSession.sessionId).not.toBe(ownerASession.sessionId)
    expect(await host.listSessions('client_shared', OWNER_1, '/repo')).toEqual([
      expect.objectContaining({ sessionId: ownerASession.sessionId, key: ownerASession.key }),
    ])
    expect(await host.listSessions('client_shared', OWNER_2, '/repo')).toEqual([
      expect.objectContaining({ sessionId: ownerBSession.sessionId, key: ownerBSession.key }),
    ])

    host.unregisterSocket('client_shared', 'attachment_a', OWNER_1, ownerASocket)
    host.unregisterSocket('client_shared', 'attachment_b', OWNER_2, ownerBSocket)
    shutdown()
  })

  test('cleans up disconnected sessions after the reconnect grace period elapses', async () => {
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    const sessionId = await createTerminalSession(host, 'client_1')

    const first = await host.attach('client_1', OWNER_1, { sessionId, cols: 80, rows: 24 })
    expect(first.ok).toBe(true)
    expect(mockPtys).toHaveLength(1)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_b', OWNER_1, socket2)
    const recreatedSessionId = await createTerminalSession(host, 'client_1')
    const replacementAttach = await host.attach('client_1', OWNER_1, {
      sessionId: recreatedSessionId,
      cols: 80,
      rows: 24,
    })
    expect(replacementAttach.ok).toBe(true)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.sessionId).not.toBe(first.sessionId)

    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socket2)
    shutdown()
  })

  test('a released controller does not implicitly regain control on reattach, but can takeover explicitly', async () => {
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    const created = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const sessionId = created.sessions[0]?.sessionId
    if (!sessionId) throw new Error('expected session id')
    host.registerSocket('client_1', 'attachment_b', OWNER_1, socketB)

    const viewerAttach = await host.attach('client_1', OWNER_1, {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })
    expect(viewerAttach.ok).toBe(true)

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    await vi.advanceTimersByTimeAsync(30_000 + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const afterRelease = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(afterRelease).toEqual([
      expect.objectContaining({
        sessionId,
        controller: null,
        cols: 80,
        rows: 24,
      }),
    ])

    const reattach = await host.attach('client_1', OWNER_1, {
      sessionId,
      cols: 101,
      rows: 31,
      attachmentId: 'attachment_a',
    })
    expect(reattach).toMatchObject({
      ok: true,
      sessionId,
      controller: null,
      canonicalCols: 80,
      canonicalRows: 24,
    })

    // Re-register the socket for `attachment_a` before the
    // explicit takeover. Under method 2 the broker check is the
    // source of truth for the attachment's `connected` state;
    // without a live socket the takeover would now (correctly)
    // reject as a no-op — see Bug D fix.
    const socketAReconnect = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketAReconnect)

    const takeover = host.takeover('client_1', OWNER_1, {
      sessionId,
      cols: 101,
      rows: 31,
      attachmentId: 'attachment_a',
    })
    expect(takeover).toEqual({
      ok: true,
      sessionId,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { attachmentId: 'attachment_a', status: 'connected' },
      canonicalCols: 101,
      canonicalRows: 31,
      phase: 'open',
    })

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketAReconnect)
    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socketB)
    shutdown()
  })

  test('expiring a disconnected viewer attachment leaves the current controller unchanged', async () => {
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socketA)
    const created = await host.create('client_1', OWNER_1, {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const sessionId = created.sessions[0]?.sessionId
    if (!sessionId) throw new Error('expected session id')

    host.registerSocket('client_1', 'attachment_b', OWNER_1, socketB)
    const viewerAttach = await host.attach('client_1', OWNER_1, {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })
    expect(viewerAttach.ok).toBe(true)

    host.unregisterSocket('client_1', 'attachment_b', OWNER_1, socketB)
    await vi.advanceTimersByTimeAsync(30_000 + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const sessionsAfterExpiry = await host.listSessions('client_1', OWNER_1, '/repo')
    expect(sessionsAfterExpiry).toEqual([
      expect.objectContaining({
        sessionId,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socketA)
    shutdown()
  })

  test('batches rapid writes into a single ordered pty write via the input queue', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    const sessionId = await createTerminalSession(host, 'client_1')

    const attach = await host.attach('client_1', OWNER_1, {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(attach.ok).toBe(true)

    host.write('client_1', OWNER_1, { sessionId, data: 'c', attachmentId: 'attachment_a' })
    host.write('client_1', OWNER_1, { sessionId, data: 'l', attachmentId: 'attachment_a' })
    host.write('client_1', OWNER_1, { sessionId, data: 'e', attachmentId: 'attachment_a' })
    host.write('client_1', OWNER_1, { sessionId, data: 'a', attachmentId: 'attachment_a' })
    host.write('client_1', OWNER_1, { sessionId, data: 'r', attachmentId: 'attachment_a' })

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
    shutdown()
  })

  test('exposes a closing-state supervisor after shutdown', async () => {
    const { host, shutdown } = buildRuntime()
    expect(host.getDiagnostics().shuttingDown).toBe(false)
    shutdown()
    expect(host.getDiagnostics().shuttingDown).toBe(true)
  })

  test('emits an ownership change when a takeover succeeds', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', OWNER_1, socket)
    const sessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    const result = await host.takeover('client_1', OWNER_1, {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_a',
    })
    expect(result.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const ownershipMessages = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'ownership')
    expect(ownershipMessages.length).toBeGreaterThan(0)
    expect(ownershipMessages.at(-1)).toMatchObject({
      event: {
        sessionId,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        cols: 100,
        rows: 30,
      },
    })

    host.unregisterSocket('client_1', 'attachment_a', OWNER_1, socket)
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
})
