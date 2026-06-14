// Server-side terminal runtime integration tests.
//
// The lower-level modules (session-manager, ownership, render-state,
// broker, catalog) carry their own focused unit tests. This file
// exercises `createServerTerminalRuntime` end-to-end through its
// `ServerTerminalHost` surface so the wiring between the supervisor,
// manager, broker, and catalog stays in lockstep with the shared
// protocol types in `shared/terminal.ts`.
// `ServerTerminalHost` surface so the wiring between the supervisor,
// manager, broker, and catalog stays in lockstep with the shared
// protocol types in `shared/terminal.ts`.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

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
        return { dispose: vi.fn(() => { if (onData === cb) onData = null }) }
      },
      onExit: (cb: () => void) => {
        onExit = cb
        return { dispose: vi.fn(() => { if (onExit === cb) onExit = null }) }
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

async function createTerminalSession(host: ServerTerminalHost, clientId: string): Promise<string> {
  const result = await host.create(clientId, {
    repoRoot: '/repo',
    branch: 'feature',
    worktreePath: '/repo-linked',
    kind: 'additional',
    cols: 80,
    rows: 24,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.sessions[0]?.sessionId ?? ''
}

describe('server terminal runtime', () => {
  test('create claims controller ownership for the provided attachment', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socket)

    const result = await host.create('client_1', {
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
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_1', 'attachment_a', socket)
    shutdown()
  })

  test('broadcasts output and exit events to registered web terminal sockets', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_1', { sessionId, cols: 80, rows: 24 })
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

    host.unregisterSocket('client_1', 'attachment_a', socket)
    shutdown()
  })

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_1', {
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
    const first = await host.create('client_1', {
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
    const second = await host.create('client_1', {
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
    host.registerSocket('client_1', 'attachment_a', socket)
    socket.send.mockClear()

    const failed = await host.create('client_1', {
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
    const sessionsAfterFailure = await host.listSessions('client_1', '/repo')
    expect(sessionsAfterFailure).toEqual([])

    // A never-spawned session has no exit event — lock in that
    // semantic so we don't regress to broadcasting a phantom exit.
    const exitBroadcasts = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'exit')
    expect(exitBroadcasts).toEqual([])

    // Retry with a working spawn must succeed as a brand-new create.
    const retried = await host.create('client_1', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(retried.ok).toBe(true)
    if (retried.ok) expect(retried.action).toBe('created')

    host.unregisterSocket('client_1', 'attachment_a', socket)
    shutdown()
  })

  test('rejects terminal reorder requests with duplicate keys', async () => {
    const { host, shutdown } = buildRuntime()
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')

    const sessionsBefore = await host.listSessions('client_1', '/repo')
    expect(sessionsBefore).toHaveLength(3)

    const result = host.reorder('client_1', {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      orderedKeys: [sessionsBefore[0]!.key, sessionsBefore[1]!.key, sessionsBefore[1]!.key],
    })

    expect(result).toBe(false)
    shutdown()
  })

  test('reorders sessions and broadcasts sessions-changed when given a valid order', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socket)
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')
    await createTerminalSession(host, 'client_1')

    const sessionsBefore = await host.listSessions('client_1', '/repo')
    expect(sessionsBefore).toHaveLength(3)
    const [first, second, third] = sessionsBefore
    if (!first || !second || !third) throw new Error('expected three sessions')
    socket.send.mockClear()

    const result = host.reorder('client_1', {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      orderedKeys: [third.key, first.key, second.key],
    })
    expect(result).toBe(true)

    const sessionsAfter = await host.listSessions('client_1', '/repo')
    expect(sessionsAfter.map((s) => s.key)).toEqual([third.key, first.key, second.key])

    // The broadcast fires for the repoRoot (not the normalized form).
    expect(
      socket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    host.unregisterSocket('client_1', 'attachment_a', socket)
    shutdown()
  })

  test('sends attach response before flushing buffered output emitted during the attach request', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      'attachment_a',
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

    host.unregisterSocket('client_1', 'attachment_a', socket)
    shutdown()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_with_$pecial!chars' as never, {
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
    host.registerSocket('client_1', 'attachment_a', socketA)
    const sessionId = await createTerminalSession(host, 'client_1')
    host.registerSocket('client_1', 'attachment_b', socketB)

    const result = host.takeover('client_1', {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })

    expect(result).toEqual({
      ok: true,
      sessionId,
      controller: { attachmentId: 'attachment_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(120, 40)

    host.unregisterSocket('client_1', 'attachment_a', socketA)
    host.unregisterSocket('client_1', 'attachment_b', socketB)
    shutdown()
  })

  test('lists repo sessions across clients and broadcasts lifecycle invalidations globally', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socketA)
    host.registerSocket('client_2', 'attachment_b', socketB)
    const sessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_1', { sessionId, cols: 80, rows: 24 })
    expect(result.ok).toBe(true)

    const sessions = await host.listSessions('client_2', '/repo')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.sessionId).toBe(sessionId)

    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    host.unregisterSocket('client_1', 'attachment_a', socketA)
    host.unregisterSocket('client_2', 'attachment_b', socketB)
    shutdown()
  })

  test('cleans up disconnected sessions after the reconnect grace period elapses', async () => {
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession(host, 'client_1')

    const first = await host.attach('client_1', { sessionId, cols: 80, rows: 24 })
    expect(first.ok).toBe(true)
    expect(mockPtys).toHaveLength(1)

    host.unregisterSocket('client_1', 'attachment_a', socket)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_b', socket2)
    const recreatedSessionId = await createTerminalSession(host, 'client_1')
    const replacementAttach = await host.attach('client_1', {
      sessionId: recreatedSessionId,
      cols: 80,
      rows: 24,
    })
    expect(replacementAttach.ok).toBe(true)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.sessionId).not.toBe(first.sessionId)

    host.unregisterSocket('client_1', 'attachment_b', socket2)
    shutdown()
  })

  test('batches rapid writes into a single ordered pty write via the input queue', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession(host, 'client_1',)

    const attach = await host.attach('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(attach.ok).toBe(true)

    host.write('client_1', { sessionId, data: 'c', attachmentId: 'attachment_a' })
    host.write('client_1', { sessionId, data: 'l', attachmentId: 'attachment_a' })
    host.write('client_1', { sessionId, data: 'e', attachmentId: 'attachment_a' })
    host.write('client_1', { sessionId, data: 'a', attachmentId: 'attachment_a' })
    host.write('client_1', { sessionId, data: 'r', attachmentId: 'attachment_a' })

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')

    host.unregisterSocket('client_1', 'attachment_a', socket)
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
    host.registerSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    const result = await host.takeover('client_1', {
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

    host.unregisterSocket('client_1', 'attachment_a', socket)
    shutdown()
  })
})
