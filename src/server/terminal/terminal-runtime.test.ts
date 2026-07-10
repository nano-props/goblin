// Server-side terminal runtime integration tests.
//
// The lower-level modules (session-manager, controller, render-state,
// broker, session service) carry their own focused unit tests. This file
// exercises `createServerTerminalRuntime` end-to-end through its
// `ServerTerminalHost` surface so the wiring between the supervisor,
// manager, broker, and session service stays in lockstep with the shared
// protocol types in `shared/terminal-types.ts`.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { clearRepoRuntimesForUser, closeRepoRuntime, openRepoRuntime } from '#/server/modules/repo-runtimes.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import { HEARTBEAT_DEADLINE_MS, HEARTBEAT_INTERVAL_MS } from '#/server/terminal/terminal-realtime-broker.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeOpenInput,
  type WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'

// Under method 2 the host threads `userId` (derived from the
// access token) alongside `clientId` (per-tab routing). Tests use
// a fixed value so the assertions don't have to mock the
// derivation helper.
const USER_1 = 'user_terminal_runtime'
const USER_2 = 'user_terminal_runtime_second'
const REPO_ROOT = '/repo'
let REPO_RUNTIME_ID = ''
let SSH_REPO_RUNTIME_ID = ''
let USER_2_REPO_RUNTIME_ID = ''
const TEST_NOW = new Date('2026-06-24T00:00:00Z')
const DETACHED_TTL_MS = 24 * 60 * 60 * 1000
const HEARTBEAT_SILENCE_MS = HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS

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
  setProcessName: (processName: string) => void
}> = []
let mockDataToEmitOnRegistration: string | null = null

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let onData: ((data: string) => void) | null = null
    let onExit: (() => void) | null = null
    let processName = 'zsh'
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data: string) => onData?.(data),
      emitExit: () => onExit?.(),
      setProcessName: (nextProcessName: string) => {
        processName = nextProcessName
      },
      get process() {
        return processName
      },
    }
    mockPtys.push(pty)
    return {
      ...pty,
      get process() {
        return processName
      },
      onData: (cb: (data: string) => void) => {
        onData = cb
        if (mockDataToEmitOnRegistration !== null) {
          const data = mockDataToEmitOnRegistration
          mockDataToEmitOnRegistration = null
          cb(data)
        }
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
  isClientOnline: (clientId: string) => boolean
}

function buildRuntime(): RuntimeHandle {
  const runtime = createServerTerminalRuntime({ ptySupervisor: createInProcessPtySupervisor() })
  REPO_RUNTIME_ID = openRepoRuntime(USER_1, REPO_ROOT)
  SSH_REPO_RUNTIME_ID = openRepoRuntime(USER_1, 'ssh-config://prod/srv/repo')
  USER_2_REPO_RUNTIME_ID = openRepoRuntime(USER_2, REPO_ROOT)
  openRepoRuntime(USER_2, 'ssh-config://prod/srv/repo')
  return {
    host: runtime.host,
    shutdown: () => runtime.shutdown(),
    isClientOnline: (clientId: string) => runtime.host.isClientOnline(USER_1, clientId),
  }
}

beforeEach(() => {
  vi.useRealTimers()
  mockPtys.length = 0
  mockDataToEmitOnRegistration = null
  vi.clearAllMocks()
  clearRepoRuntimesForUser(USER_1)
  clearRepoRuntimesForUser(USER_2)
})

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function flushPromiseQueue(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function sentSocketMessages(socket: {
  send: ReturnType<typeof vi.fn>
}): Array<{ type?: string; [key: string]: unknown }> {
  return socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
}

async function requestWorkspacePaneTabs(
  host: ServerTerminalHost,
  socket: { send: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> },
  action: string,
  input: unknown,
  requestId: string,
): Promise<unknown> {
  host.handleRealtimeMessage(
    'client_a',
    USER_1,
    socket as Parameters<ServerTerminalHost['handleRealtimeMessage']>[2],
    JSON.stringify({
      type: 'request',
      requestId,
      action,
      input,
    }),
  )
  await vi.waitFor(() => {
    expect(
      sentSocketMessages(socket).some((message) => message.type === 'response' && message.requestId === requestId),
    ).toBe(true)
  })
  const response = sentSocketMessages(socket).find(
    (message) => message.type === 'response' && message.requestId === requestId,
  )
  expect(response).toMatchObject({ type: 'response', ok: true, action })
  return response?.payload
}

async function requestWorkspacePaneRuntime(
  host: ServerTerminalHost,
  socket: { send: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> },
  input: WorkspacePaneRuntimeOpenInput,
  requestId: string,
): Promise<WorkspacePaneRuntimeOpenResult> {
  return (await requestWorkspacePaneTabs(
    host,
    socket,
    WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
    input,
    requestId,
  )) as WorkspacePaneRuntimeOpenResult
}

async function createTerminalSession(host: ServerTerminalHost, clientId: string, userId = USER_1): Promise<string> {
  const result = await host.create(clientId, userId, {
    repoRoot: REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
    branch: 'feature',
    worktreePath: '/repo-linked',
    kind: 'additional',
    cols: 80,
    rows: 24,
    ...(clientId ? { clientId } : {}),
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.sessions[0]?.terminalRuntimeSessionId ?? ''
}

describe('server terminal runtime', () => {
  test('create claims controller control for the provided attachment', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const result = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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
        terminalSessionId: result.terminalSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        phase: 'opening',
        message: null,
        cols: 80,
        rows: 24,
      }),
    ])
    const terminalRuntimeSessionId = result.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')

    mockPtys[0]?.emitData('ready')

    await expect(
      host.listSessions('client_a', USER_1, { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }),
    ).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        phase: 'open',
        message: null,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('create broadcasts terminal sessions without invalidating workspace pane tabs', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const result = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })

    expect(result.ok).toBe(true)
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', repoRoot: REPO_ROOT },
    ])
    expect(
      sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
    ).toBe(false)

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
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')

    const attachResult = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(attachResult).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalCols: 80,
      canonicalRows: 24,
    })

    const sessions = await host.listSessions('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
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
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    const prompt =
      '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J👾:~/repo\r\n$ '
    mockPtys[0]?.emitData(prompt)

    const attach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(attach.ok).toBe(true)
    if (!attach.ok) return
    expect(attach.snapshot).toBe('👾:~/repo\r\n$ ')
    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reattaching after presence goes offline auto-reclaims control and canonical geometry', async () => {
    // The previous revision had a 30s grace sub-state that kept the
    // controller role occupied between offline and online transitions. The
    // current model keeps controller intent but derives the effective
    // controller from broker presence, so a reattach can reclaim with
    // fresh geometry when no effective controller is present.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)

    const createResult = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')

    host.unregisterSocket('client_a', USER_1, socketA)
    const socketA2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA2)

    const reattachResult = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 101,
      rows: 31,
      clientId: 'client_a',
    })
    expect(reattachResult).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalCols: 101,
      canonicalRows: 31,
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    const sessions = await host.listSessions('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_resize',
        action: 'attach',
        input: { terminalRuntimeSessionId, cols: 101, rows: 31, clientId: 'client_a' },
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
        terminalRuntimeSessionId,
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

  test('broadcasts output, title, bell, and exit events to registered web terminal sockets', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
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
      event: { terminalRuntimeSessionId, terminalSessionId: expect.any(String), data: 'hello', outputEra: 0, seq: 1 },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b]0;build running\x07done\x07')
    const bellMessage = sentSocketMessages(socket).find((message) => message.type === 'bell')
    expect(bellMessage).toMatchObject({
      type: 'bell',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        repoRoot: '/repo',
        worktreePath: '/repo-linked',
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
        repoRoot: '/repo',
        worktreePath: '/repo-linked',
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
        repoRoot: '/repo',
        worktreePath: '/repo-linked',
        canonicalTitle: 'devin running',
      },
    })

    mockPtys[0]?.emitExit()
    const exitMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'exit')
    expect(exitMessage).toMatchObject({
      type: 'exit',
      event: { terminalRuntimeSessionId, terminalSessionId: expect.any(String) },
    })
    expect(host.getDiagnostics().terminal.pty.state).toBe('idle')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('clears stale title on non-shell to shell transition before emitting same-chunk bell', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
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
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'feature',
          worktreePath: '/repo-linked',
          kind: 'additional',
          cols: 80,
          rows: 24,
        },
      },
      'req_open_terminal_before_exit',
    )
    expect(opened.ok).toBe(true)
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
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        'req_list_after_exit',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'feature',
          worktreePath: '/repo-linked',
          tabs: [expect.objectContaining({ type: 'status' })],
        },
      ],
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reconciles workspace tabs when prune closes removed-worktree sessions', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'feature',
          worktreePath: '/repo-linked',
          kind: 'additional',
          cols: 80,
          rows: 24,
        },
      },
      'req_open_terminal_before_prune',
    )
    expect(opened.ok).toBe(true)
    socket.send.mockClear()
    vi.mocked(getWorktrees).mockResolvedValueOnce([])

    await expect(
      host.prune('client_a', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
    ).resolves.toEqual({ pruned: 1, remaining: 0 })

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
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        'req_list_after_prune',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'feature',
          worktreePath: '/repo-linked',
          tabs: [expect.objectContaining({ type: 'status' })],
        },
      ],
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('realtime workspace pane tabs replace materializes missing terminal tabs and list returns canonical tabs', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const created = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branchName: 'feature',
          worktreePath: '/repo-linked',
          tabs: [{ type: 'status', tabId: 'workspace-pane:status' }],
        },
        'req_replace_workspace_tabs',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'terminal', runtimeSessionId: created.terminalSessionId },
          ],
        },
      ],
    })
    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_list_workspace_tabs',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        input: { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      }),
    )

    await vi.waitFor(() => {
      const messages = sentSocketMessages(socket)
      expect(
        messages.some((message) => message.type === 'response' && message.requestId === 'req_list_workspace_tabs'),
      ).toBe(true)
    })
    const response = sentSocketMessages(socket).find(
      (message) => message.type === 'response' && message.requestId === 'req_list_workspace_tabs',
    )
    expect(response).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      payload: {
        revision: expect.any(Number),
        entries: [
          {
            repoRoot: REPO_ROOT,
            branchName: 'feature',
            worktreePath: '/repo-linked',
            tabs: [
              { type: 'status', tabId: 'workspace-pane:status' },
              { type: 'terminal', runtimeSessionId: created.terminalSessionId },
            ],
          },
        ],
      },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('unregisters a buffered socket when raw send fails during broadcast', async () => {
    const { host, shutdown, isClientOnline } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    await createTerminalSession(host, 'client_a')
    socket.send.mockImplementation(() => {
      throw new Error('socket closed')
    })

    mockPtys[0]?.emitData('hello')

    expect(host.getDiagnostics().terminal.registeredSockets).toBe(0)
    expect(isClientOnline('client_a')).toBe(false)
    shutdown()
  })

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_a', USER_1, {
      repoRoot: 'ssh-config://prod/srv/repo',
      repoRuntimeId: SSH_REPO_RUNTIME_ID,
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
        terminalSessionId: expect.stringMatching(/^term-[A-Za-z0-9_-]{21}$/),
        repoRoot: 'ssh-config://prod/srv/repo',
        worktreePath: '/srv/repo',
      }),
    ])

    shutdown()
  })

  test('reuses the existing terminal when reopening the same repo root', async () => {
    const { host, shutdown } = buildRuntime()
    const first = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('reused')
    expect(second.terminalSessionId).toBe(first.terminalSessionId)

    shutdown()
  })

  test('repo runtime close makes old terminal sessions and workspace tabs unreachable to the reopened runtime', async () => {
    const { host, shutdown } = buildRuntime()
    const first = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branchName: 'feature',
          worktreePath: '/repo-linked',
          operation: { type: 'open-static', tabType: 'history' },
        },
        'req_update_before_repo_close',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'history', tabId: 'workspace-pane:history' },
            { type: 'terminal', runtimeSessionId: first.terminalSessionId },
          ],
        },
      ],
    })
    socket.send.mockClear()

    expect(closeRepoRuntime(USER_1, REPO_ROOT, REPO_RUNTIME_ID)).toBe(true)
    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).filter((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toHaveLength(1)
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toHaveLength(1)
    const nextRepoRuntimeId = openRepoRuntime(USER_1, REPO_ROOT)

    await expect(
      host.listSessions('client_a', USER_1, { repoRoot: REPO_ROOT, repoRuntimeId: nextRepoRuntimeId }),
    ).resolves.toEqual([])
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        { repoRoot: REPO_ROOT, repoRuntimeId: nextRepoRuntimeId },
        'req_list_after_repo_reopen',
      ),
    ).resolves.toEqual({ revision: 0, entries: [] })

    const second = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: nextRepoRuntimeId,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('created')
    expect(second.terminalSessionId).not.toBe(first.terminalSessionId)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('serializes concurrent primary creates for the same worktree', async () => {
    const worktrees: WorktreeInfo[] = [{ path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false }]
    const firstWorktrees = createDeferred<WorktreeInfo[]>()
    const secondWorktrees = createDeferred<WorktreeInfo[]>()
    vi.mocked(getWorktrees)
      .mockImplementationOnce(async () => await firstWorktrees.promise)
      .mockImplementationOnce(async () => await secondWorktrees.promise)
    const { host, shutdown } = buildRuntime()

    const first = host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    const second = host.create('client_b', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })

    await vi.waitFor(() => expect(getWorktrees).toHaveBeenCalledTimes(1))
    await flushPromiseQueue()
    expect(getWorktrees).toHaveBeenCalledTimes(1)

    firstWorktrees.resolve(worktrees)
    const firstResult = await first
    expect(firstResult.ok).toBe(true)
    if (!firstResult.ok) return
    expect(firstResult.action).toBe('created')

    await vi.waitFor(() => expect(getWorktrees).toHaveBeenCalledTimes(2))
    secondWorktrees.resolve(worktrees)
    const secondResult = await second
    expect(secondResult.ok).toBe(true)
    if (!secondResult.ok) return
    expect(secondResult.action).toBe('reused')
    expect(secondResult.terminalSessionId).toBe(firstResult.terminalSessionId)
    expect(secondResult.terminalRuntimeSessionId).toBe(firstResult.terminalRuntimeSessionId)
    expect(mockPtys).toHaveLength(1)
    expect(mockPtys[0]?.kill).not.toHaveBeenCalled()

    shutdown()
  })

  test('reopening an existing terminal from a new attachment auto-reclaims user-sticky control', async () => {
    const { host, shutdown } = buildRuntime()
    const browserSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_browser', USER_1, browserSocket)

    const first = await host.create('client_browser', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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
    expect(reopened.terminalSessionId).toBe(first.terminalSessionId)
    expect(reopened.controller).toEqual({ clientId: 'client_electron', status: 'connected' })
    expect(reopened.canonicalCols).toBe(102)
    expect(reopened.canonicalRows).toBe(33)
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(102, 33)

    const sessions = await host.listSessions('client_electron', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalSessionId: first.terminalSessionId,
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(failed.ok).toBe(false)
    if (failed.ok) return

    // After the failure, listSessions must not report the zombie. If
    // it did, the session service would match it on retry and surface a
    // blank, non-responsive terminal as a successful attach.
    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessionsAfterFailure).toEqual([])

    // A never-spawned session has no exit event — lock in that
    // semantic so we don't regress to broadcasting a phantom exit.
    const exitBroadcasts = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'exit')
    expect(exitBroadcasts).toEqual([])

    // Retry with a working spawn must succeed as a brand-new create.
    const retried = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')

    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })

    const restarted = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(restarted.ok).toBe(false)
    if (restarted.ok) return
    expect(restarted.message).toBe('pty restart failed')

    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
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
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const restarted = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_b',
    })
    expect(restarted.ok).toBe(false)
    if (!restarted.ok) return
    expect(restarted.message).toBe('error.not-controller')

    // Stored controller intent still points at `client_a`, and `client_a`
    // is the effective controller; a subsequent restart from that client
    // must pass the authority check (here it fails later at spawn).
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })
    const retry = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
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

  test('drops buffered output covered by the attach response snapshot', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach',
        action: 'attach',
        input: { terminalRuntimeSessionId, cols: 80, rows: 24 },
      }),
    )
    mockPtys[0]?.emitData('during-attach')

    await vi.waitFor(() => {
      expect(socket.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
    })

    const messages = socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex((message) => message.type === 'response')
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(messages[responseIndex]).toMatchObject({
      type: 'response',
      requestId: 'req_attach',
      ok: true,
      action: 'attach',
      payload: {
        ok: true,
        snapshot: expect.stringContaining('during-attach'),
        snapshotSeq: 1,
      },
    })
    expect(messages.some((message) => message.type === 'output')).toBe(false)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('runtime-open returns terminal and canonical tabs before flushing provider realtime', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    mockDataToEmitOnRegistration = 'during-runtime-open'

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
            repoRoot: REPO_ROOT,
            repoRuntimeId: REPO_RUNTIME_ID,
            branch: 'feature',
            worktreePath: '/repo-linked',
            kind: 'primary',
            cols: 80,
            rows: 24,
            clientId: 'forged_client',
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
          snapshot: expect.stringContaining('during-runtime-open'),
          snapshotSeq: 1,
          controller: { clientId: 'client_a', status: 'connected' },
        },
        workspacePaneTabs: {
          revision: expect.any(Number),
          entries: [
            {
              tabs: [
                { type: 'status', tabId: 'workspace-pane:status' },
                { type: 'terminal', runtimeSessionId: expect.any(String) },
              ],
            },
          ],
        },
      },
    })
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
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: 'feature',
          worktreePath: '/repo-linked',
          kind: 'additional',
          cols: 80,
          rows: 24,
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
            repoRoot: REPO_ROOT,
            repoRuntimeId: REPO_RUNTIME_ID,
            branchName: 'feature',
            worktreePath: '/repo-linked',
          },
        },
        'req_runtime_close',
      ),
    ).resolves.toMatchObject({
      ok: true,
      runtimeType: 'terminal',
      workspacePaneTabs: {
        revision: expect.any(Number),
        entries: [{ tabs: [{ type: 'status', tabId: 'workspace-pane:status' }] }],
      },
    })
    await expect(
      host.listSessions('client_a', USER_1, { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }),
    ).resolves.toEqual([])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await host.create('client_with_$pecial!chars' as never, USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    host.registerSocket('client_b', USER_1, socketB)

    const result = host.takeover('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })

    expect(result).toEqual({
      ok: true,
      terminalRuntimeSessionId,
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
        input: { terminalRuntimeSessionId, cols: 120, rows: 40, clientId: 'client_b' },
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
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)

    const sessions = await host.listSessions('client_2', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.terminalRuntimeSessionId).toBe(terminalRuntimeSessionId)

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

  test('isolates terminal session service reads and lifecycle broadcasts by userId', async () => {
    const { host, shutdown } = buildRuntime()
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_shared_attachment_a', USER_1, userASocket)
    host.registerSocket('client_shared_attachment_b', USER_2, userBSocket)

    const userACreate = await host.create('client_shared', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
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

    expect(
      await host.listSessions('client_shared', USER_2, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: USER_2_REPO_RUNTIME_ID,
      }),
    ).toEqual([])
    await expect(
      host.close('client_shared', USER_2, { terminalRuntimeSessionId: userASession.terminalRuntimeSessionId }),
    ).resolves.toBe(false)
    expect(
      userBSocket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(false)

    const userBCreate = await host.create('client_shared', USER_2, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: USER_2_REPO_RUNTIME_ID,
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

    expect(userBSession.terminalSessionId).not.toBe(userASession.terminalSessionId)
    expect(userBSession.terminalRuntimeSessionId).not.toBe(userASession.terminalRuntimeSessionId)
    expect(
      await host.listSessions('client_shared', USER_1, { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }),
    ).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: userASession.terminalRuntimeSessionId,
        terminalSessionId: userASession.terminalSessionId,
      }),
    ])
    expect(
      await host.listSessions('client_shared', USER_2, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: USER_2_REPO_RUNTIME_ID,
      }),
    ).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: userBSession.terminalRuntimeSessionId,
        terminalSessionId: userBSession.terminalSessionId,
      }),
    ])

    host.unregisterSocket('client_shared_attachment_a', USER_1, userASocket)
    host.unregisterSocket('client_shared_attachment_b', USER_2, userBSocket)
    shutdown()
  })

  test('cleans up detached user sessions after the detached TTL elapses', async () => {
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const first = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(first.ok).toBe(true)
    expect(mockPtys).toHaveLength(1)

    host.unregisterSocket('client_a', USER_1, socket)
    await vi.advanceTimersByTimeAsync(DETACHED_TTL_MS + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_b', USER_1, socket2)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket2,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        'req_list_after_detached_ttl',
      ),
    ).resolves.toEqual({ revision: 0, entries: [] })

    const recreatedSessionId = await createTerminalSession(host, 'client_1')
    const replacementAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId: recreatedSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_b',
    })
    expect(replacementAttach.ok).toBe(true)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.terminalRuntimeSessionId).not.toBe(first.terminalRuntimeSessionId)

    host.unregisterSocket('client_b', USER_1, socket2)
    shutdown()
  })

  test('after the controller goes offline, a sibling attachment auto-claims on attach (single-user)', async () => {
    // Device-switch scenario: A was the controller intent (from
    // create); A's socket closes, so A is no longer the effective
    // controller. B then attaches and auto-claims without explicit
    // takeover because no effective controller is present.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')

    host.unregisterSocket('client_a', USER_1, socketA)

    // B comes online and attaches — no explicit takeover needed
    // because A is no longer the effective controller.
    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(viewerAttach).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
    })

    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('a late-returning original controller stays a viewer once a sibling has claimed control (no grace restore)', async () => {
    // The user-sticky model keeps controller intent but derives
    // effective control from presence. If a sibling attachment
    // attaches while the original controller is offline, the sibling
    // claims control. When the original
    // controller eventually reconnects, it is a viewer — the
    // previous design's grace restore ("same clientId keeps
    // control after briefly going offline") does not apply. The
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
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')
    mockPtys[0]?.emitData('ready')

    // A goes offline; B attaches and claims because no effective controller remains.
    host.unregisterSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const bAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
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
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(aReattach).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      // A's view sees B still in control.
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // And A's write is rejected — server-side authority check fails
    // with not-controller. The client-side AuthorityGate catches
    // this and fires a takeover before retrying; this test pins the
    // server invariant.
    const aWrite = host.write('client_a', USER_1, {
      terminalRuntimeSessionId,
      data: 'ls\n',
      clientId: 'client_a',
    })
    expect(aWrite).toBe(false)

    // B's write still works.
    const bWrite = host.write('client_a', USER_1, {
      terminalRuntimeSessionId,
      data: 'pwd\n',
      clientId: 'client_b',
    })
    expect(bWrite).toBe(true)
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    // listSessions confirms the global view: B is the controller,
    // canonical geometry follows B (the most recent writer).
    const sessions = await host.listSessions('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_b', status: 'connected' },
        cols: 120,
        rows: 40,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketAReconnect)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('viewer presence going offline leaves the current controller unchanged', async () => {
    // The previous revision had a grace sub-state that, on expiry,
    // would remove the offline viewer via `expireAttachment`.
    // The current model has no per-attachment grace — only the
    // detached TTL fires (after 24h), which is far longer than the
    // test. The relevant invariant is that an offline viewer
    // doesn't disturb the controller.
    vi.useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await host.create('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.sessions[0]?.terminalRuntimeSessionId
    if (!terminalRuntimeSessionId) throw new Error('expected session id')

    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(viewerAttach.ok).toBe(true)

    host.unregisterSocket('client_b', USER_1, socketB)
    // The detached TTL is 24h — far longer than any grace we used
    // to have. Run a small tick to flush the socket-offline
    // microtask without firing any timer.
    await Promise.resolve()

    const sessionsAfterExpiry = await host.listSessions('client_a', USER_1, {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    expect(sessionsAfterExpiry).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
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
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    mockPtys[0]?.emitData('ready')

    const attach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(attach.ok).toBe(true)

    host.write('client_a', USER_1, { terminalRuntimeSessionId, data: 'c', clientId: 'client_a' })
    host.write('client_a', USER_1, { terminalRuntimeSessionId, data: 'l', clientId: 'client_a' })
    host.write('client_a', USER_1, { terminalRuntimeSessionId, data: 'e', clientId: 'client_a' })
    host.write('client_a', USER_1, { terminalRuntimeSessionId, data: 'a', clientId: 'client_a' })
    host.write('client_a', USER_1, { terminalRuntimeSessionId, data: 'r', clientId: 'client_a' })

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('exposes a closing-state supervisor after shutdown', async () => {
    const { host, shutdown } = buildRuntime()
    expect(host.getDiagnostics().terminal.shuttingDown).toBe(false)
    shutdown()
    expect(host.getDiagnostics().terminal.shuttingDown).toBe(true)
  })

  test('shutdown does not leave detached-user timers after closing registered sockets', () => {
    vi.useFakeTimers()
    try {
      const { host, shutdown } = buildRuntime()
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_shutdown', USER_1, socket)

      shutdown()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('emits an identity change when a takeover succeeds', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    const result = await host.takeover('client_a', USER_1, {
      terminalRuntimeSessionId,
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
        terminalRuntimeSessionId,
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
      let stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(0)
      expect(stats.totalRingBufferChars).toBe(0)
      expect(stats.maxRingBufferChars).toBe(0)

      // Create two sessions; their buffers start empty.
      const sessionA = await createTerminalSession(host, 'client_1')
      const sessionB = await createTerminalSession(host, 'client_1')
      stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(0)
      expect(stats.maxRingBufferChars).toBe(0)

      // Emit data into the first session's PTY. The manager's
      // onOutput sink routes through broker.broadcast but also
      // appends to the per-session render buffer, which is what
      // the new diagnostic fields measure.
      mockPtys[0]?.emitData('aaaaa')
      stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(5)
      expect(stats.maxRingBufferChars).toBe(5)

      // Emit more data into the second session. The max should
      // track the larger of the two; the total should sum both.
      mockPtys[1]?.emitData('bbbbbbbbbb')
      stats = host.getDiagnostics().terminal
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

  test('runtime routes a heartbeat envelope to the broker with the right (userId, clientId) pair', async () => {
    // Regression guard for the
    // `broker.recordHeartbeat(clientId, userId)` arg-order bug
    // that the original implementation shipped. The broker keys
    // on `userClientKey(userId, clientId)`, so a swapped call
    // silently misses every live heartbeat — the deadline scan
    // then prematurely flips presence offline for healthy
    // controllers. The broker unit tests passed because they
    // call the broker directly with the right order; this test
    // covers the wiring through the runtime's `handleRealtimeMessage`.
    //
    // The assertion is end-to-end: after a real heartbeat has been
    // routed through the runtime, advancing the fake clock past
    // the original deadline must NOT flip broker presence offline.
    // The raw socket would remain registered either way; this assertion
    // is about `isClientOnline`.
    const { host, shutdown, isClientOnline } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    vi.useFakeTimers()
    try {
      vi.setSystemTime(TEST_NOW)

      // First heartbeat at t=0.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      // Advance just shy of the original deadline.
      vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS - 1_000)
      // Heartbeat again — this MUST use the right (userId, clientId)
      // order, otherwise the broker's clock never updates and the
      // very next scan would flip presence offline.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      // Advance past the original 90 s deadline. A correctly routed
      // heartbeat (a real client sending every 30 s) means the
      // broker clock is fresh, so presence must remain online.
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      expect(isClientOnline('client_a')).toBe(true)
    } finally {
      vi.useRealTimers()
      shutdown()
    }
  })

  test('runtime answers terminal socket health pings with pong', () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'ping', requestId: 'health_1' }))

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', requestId: 'health_1' }))
    shutdown()
  })

  test('runtime health ping refreshes broker presence before the next heartbeat scan', () => {
    vi.useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_a', USER_1, socket)

      vi.advanceTimersByTime(1)
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      vi.advanceTimersByTime(99_999)
      expect(handle.isClientOnline('client_a')).toBe(true)

      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'ping', requestId: 'health_1' }))
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

      expect(handle.isClientOnline('client_a')).toBe(true)
      expect(socket.close).not.toHaveBeenCalledWith(1001, 'terminal heartbeat timeout')
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', requestId: 'health_1' }))
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: controller projection recovers when a long-idle client reconnects', async () => {
    vi.useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_idle', USER_1, socket)
      const terminalRuntimeSessionId = await createTerminalSession(host, 'client_idle')

      expect(
        await host.listSessions('client_idle', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: { clientId: 'client_idle', status: 'connected' },
        }),
      ])

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_idle')).toBe(false)
      expect(
        await host.listSessions('client_idle', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: null,
        }),
      ])

      const reconnectedSocket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_idle', USER_1, reconnectedSocket)
      expect(handle.isClientOnline('client_idle')).toBe(true)
      expect(
        await host.listSessions('client_idle', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: { clientId: 'client_idle', status: 'connected' },
        }),
      ])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: recovered heartbeat cancels detached cleanup after a heartbeat timeout', async () => {
    vi.useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_recovered', USER_1, socket)
      await createTerminalSession(host, 'client_recovered')

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_recovered')).toBe(false)

      const reconnectedSocket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_recovered', USER_1, reconnectedSocket)
      expect(handle.isClientOnline('client_recovered')).toBe(true)

      for (let elapsed = 0; elapsed < DETACHED_TTL_MS + 1; elapsed += HEARTBEAT_INTERVAL_MS) {
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
        host.handleRealtimeMessage('client_recovered', USER_1, reconnectedSocket, JSON.stringify({ type: 'heartbeat' }))
      }
      await vi.runOnlyPendingTimersAsync()
      await expect(
        host.listSessions('client_recovered', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
      ).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: detached TTL cleans up when heartbeat timeout leaves only half-open sockets', async () => {
    vi.useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_half_open', USER_1, socket)
      await createTerminalSession(host, 'client_half_open')

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(host.getDiagnostics().terminal.registeredSockets).toBe(0)
      expect(handle.isClientOnline('client_half_open')).toBe(false)

      await vi.advanceTimersByTimeAsync(DETACHED_TTL_MS + 1)
      await vi.runOnlyPendingTimersAsync()

      expect(host.getDiagnostics().terminal.liveSessionCount).toBe(0)
      await expect(
        host.listSessions('client_half_open', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
      ).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: late socket drain does not extend detached TTL after heartbeat timeout', async () => {
    vi.useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_late_drain', USER_1, socket)
      await createTerminalSession(host, 'client_late_drain')

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_late_drain')).toBe(false)

      await vi.advanceTimersByTimeAsync(DETACHED_TTL_MS - 1_000)
      host.unregisterSocket('client_late_drain', USER_1, socket)
      await vi.advanceTimersByTimeAsync(1_001)
      await vi.runOnlyPendingTimersAsync()

      expect(host.getDiagnostics().terminal.liveSessionCount).toBe(0)
      await expect(
        host.listSessions('client_late_drain', USER_1, { repoRoot: '/repo', repoRuntimeId: REPO_RUNTIME_ID }),
      ).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a silent client (no heartbeats) is marked offline past the deadline', async () => {
    vi.useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_silent', USER_1, socket)

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_silent')).toBe(false)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })
})
