import { beforeEach, describe, expect, test, vi } from 'vitest'
import { spawn } from 'node-pty'
import path from 'node:path'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import {
  closeAllServerTerminalSessions,
  createServerTerminal,
  getServerTerminalSessionSnapshot,
  handleRealtimeServerMessage,
  listServerTerminalSessions,
  reorderServerTerminals,
  attachServerTerminal,
  registerTerminalSocket,
  restartServerTerminal,
  resizeServerTerminal,
  takeoverServerTerminal,
  unregisterTerminalSocket,
  writeServerTerminal,
} from '#/server/terminal/terminal.ts'

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

interface MockPty {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: () => void
  setProcessName: (next: string) => void
  /** Tracks how many times the `process` getter was read. */
  processReads: () => number
}

const mockPtys: MockPty[] = []

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let onData: ((data: string) => void) | null = null
    let onExit: (() => void) | null = null
    let processName = 'zsh'
    let processReads = 0
    const pty: MockPty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data) => onData?.(data),
      emitExit: () => onExit?.(),
      setProcessName: (next) => {
        processName = next
      },
      processReads: () => processReads,
    }
    mockPtys.push(pty)
    return {
      get process() {
        processReads += 1
        return processName
      },
      write: pty.write,
      resize: pty.resize,
      kill: pty.kill,
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

beforeEach(() => {
  vi.useRealTimers()
  closeAllServerTerminalSessions()
  mockPtys.length = 0
  vi.clearAllMocks()
  vi.mocked(spawn).mockClear()
})

async function createTerminalSession(
  clientId: string,
  overrides: Partial<{
    repoRoot: string
    branch: string
    worktreePath: string
    cols: number
    rows: number
  }> = {},
): Promise<string> {
  const repoRoot = overrides.repoRoot ?? '/repo'
  const worktreePath = overrides.worktreePath ?? '/repo-linked'
  const result = await createServerTerminal(clientId, {
    repoRoot,
    branch: overrides.branch ?? 'feature',
    worktreePath,
    kind: 'additional',
    cols: overrides.cols,
    rows: overrides.rows,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  const session = result.sessions.find((item) => item.key === result.key)
  if (!session) throw new Error('missing created terminal session')
  return session.sessionId
}

describe('server terminal sessions', () => {
  test('create claims controller ownership for the provided attachment', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)

    const result = await createServerTerminal('client_1', {
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

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  // Path.isAbsolute's behaviour for `C:/...` is platform-specific: it returns
  // true on win32, false on every other platform. The forward-slash Windows
  // shape only really exists on win32, so the catalog path through it is
  // only exercised there. We still want CI to cover the SSH branch, so the
  // Windows case is gated to win32.
  //
  // The expected key uses backslashes because the catalog normalizes both
  // the scope and the worktree path through path.resolve() at the entry —
  // otherwise a forward-slash input would never match the back-slash form
  // already stored on the manager.
  test.skipIf(process.platform !== 'win32')(
    'returns created terminal sessions for Windows forward-slash repository paths',
    async () => {
      vi.mocked(getWorktrees).mockResolvedValueOnce([
        { path: 'C:/Users/example/repo', branch: 'feature', isBare: false, isPrimary: true },
      ])

      const result = await createServerTerminal('client_1', {
        repoRoot: 'C:/Users/example/repo',
        branch: 'feature',
        worktreePath: 'C:/Users/example/repo',
        kind: 'primary',
        cols: 80,
        rows: 24,
        attachmentId: 'attachment_a',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.sessions).toEqual([
        expect.objectContaining({
          key: 'C:\\Users\\example\\repo\0C:\\Users\\example\\repo\0terminal-1',
        }),
      ])
      await expect(listServerTerminalSessions('client_1', 'C:/Users/example/repo')).resolves.toEqual(result.sessions)
    },
  )

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const result = await createServerTerminal('client_1', {
      repoRoot: 'ssh-config://prod/srv/repo',
      branch: 'feature',
      worktreePath: '/srv/repo',
      kind: 'primary',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' })
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/ssh(?:\.exe)?$/i),
      expect.arrayContaining(['-tt', '--', 'prod']),
      expect.objectContaining({ cwd: process.cwd() }),
    )
    expect(result.sessions).toEqual([
      expect.objectContaining({
        key: 'ssh-config://prod/srv/repo\0/srv/repo\0terminal-1',
      }),
    ])
    await expect(listServerTerminalSessions('client_1', 'ssh-config://prod/srv/repo')).resolves.toEqual(result.sessions)
  })

  // Regression: re-opening the same repo root must report 'reused' or
  // 'restored' rather than 'created'. The catalog normalizes the path
  // for both the manager scope and the session key; without that
  // normalization, callers that mix forward- and back-slash Windows
  // paths (or relative vs absolute) would never match an existing
  // session and would spawn a fresh pty every time.
  test('reuses the existing terminal when reopening the same repo root', async () => {
    const first = await createServerTerminal('client_1', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.action).toBe('created')

    // Same repo/worktree, second open — should be 'reused' (no controller
    // on the original session yet).
    const second = await createServerTerminal('client_1', {
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('reused')
    expect(second.key).toBe(first.key)
  })

  test('broadcasts output and exit events to registered web terminal sockets', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')

    const result = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    mockPtys[0]?.emitData('hello')
    const outputMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'output')
    expect(outputMessage).toMatchObject({
      type: 'output',
      event: { data: 'hello', seq: 1, processName: 'zsh' },
    })

    mockPtys[0]?.emitExit()
    const exitMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'exit')
    expect(exitMessage).toMatchObject({
      type: 'exit',
      event: { sessionId: expect.any(String) },
    })

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('caches processName across plain output chunks and refreshes on title OSC', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')
    socket.send.mockClear()

    // Initial read happens once at spawn. Reset the counter so we can
    // assert the cache holds for chunks that do not carry a title OSC.
    const initialReads = mockPtys[0]?.processReads() ?? 0

    // Plain chunks without OSC must NOT re-read pty.processName.
    mockPtys[0]?.setProcessName('bash')
    mockPtys[0]?.emitData('plain-output-a')
    mockPtys[0]?.emitData('plain-output-b')
    mockPtys[0]?.emitData('plain-output-c')

    const plainMessages = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'output')
    expect(plainMessages).toHaveLength(3)
    expect(plainMessages.map((m) => m.event.processName)).toEqual(['zsh', 'zsh', 'zsh'])
    expect(mockPtys[0]?.processReads()).toBe(initialReads)

    // A title OSC (BEL-terminated `\x1b]0;...\x07`) is the documented
    // signal that the shell exec'd a new command. The cached name should
    // refresh exactly once and every subsequent chunk should carry the
    // refreshed value without re-reading the getter.
    mockPtys[0]?.emitData('\x1b]0;vim\x07')
    mockPtys[0]?.emitData('plain-output-d')
    mockPtys[0]?.emitData('plain-output-e')

    const allMessages = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'output')
    expect(allMessages.slice(3).map((m) => m.event.processName)).toEqual(['bash', 'bash', 'bash'])
    // One re-read at title change, zero more on the following plain chunks.
    expect(mockPtys[0]?.processReads()).toBe(initialReads + 1)

    // Mixed chunks — title OSC surrounded by plain bytes — must trigger
    // exactly one re-read. extractTitle uses /g and processes the whole
    // chunk at once, so a single OSC inside plain text is treated as
    // "title changed" with no extra re-reads.
    mockPtys[0]?.setProcessName('python3')
    mockPtys[0]?.emitData('prefix\x1b]0;python\x07suffix')
    mockPtys[0]?.emitData('plain-output-f')

    const finalMessages = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'output')
    expect(finalMessages.slice(-2).map((m) => m.event.processName)).toEqual(['python3', 'python3'])
    expect(mockPtys[0]?.processReads()).toBe(initialReads + 2)

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('rejects terminal reorder requests with duplicate keys', async () => {
    await createTerminalSession('client_1')
    await createTerminalSession('client_1')
    await createTerminalSession('client_1')

    const sessionsBefore = await listServerTerminalSessions('client_1', '/repo')
    expect(sessionsBefore).toHaveLength(3)

    const result = reorderServerTerminals('client_1', {
      repoRoot: '/repo',
      worktreePath: '/repo-linked',
      orderedKeys: [sessionsBefore[0]!.key, sessionsBefore[1]!.key, sessionsBefore[1]!.key],
    })

    expect(result).toBe(false)
    await expect(listServerTerminalSessions('client_1', '/repo')).resolves.toEqual(sessionsBefore)
  })

  test('sends attach response before flushing buffered output emitted during the attach request', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')
    socket.send.mockClear()

    handleRealtimeServerMessage(
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
      payload: {
        ok: true,
        sessionId,
      },
    })
    expect(messages[outputIndex]).toMatchObject({
      type: 'output',
      event: {
        sessionId,
        data: 'during-attach',
        seq: 1,
        processName: 'zsh',
      },
    })

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('drops buffered attach output when the socket disconnects before the paused request resumes', async () => {
    const socket = {
      send: vi.fn(() => {
        throw new Error('socket closed')
      }),
      close: vi.fn(),
    }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')
    socket.send.mockClear()

    handleRealtimeServerMessage(
      'client_1',
      'attachment_a',
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_closed',
        action: 'attach',
        input: { sessionId, cols: 80, rows: 24 },
      }),
    )
    mockPtys[0]?.emitData('during-attach')
    unregisterTerminalSocket('client_1', 'attachment_a', socket)

    // Wait for the attach response send to fail. Multiple ticks
    // cover the microtask that fires the onOutput broadcast plus
    // the macrotask needed to flush the BufferedTerminalSocket.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(socket.send).toHaveBeenCalledTimes(1)
  })

  test('deactivates the buffered socket when sending the attach response fails', async () => {
    const socket = {
      send: vi.fn(() => {
        throw new Error('socket closed')
      }),
      close: vi.fn(),
    }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')
    socket.send.mockClear()

    handleRealtimeServerMessage(
      'client_1',
      'attachment_a',
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_send_fail',
        action: 'attach',
        input: { sessionId, cols: 80, rows: 24 },
      }),
    )
    mockPtys[0]?.emitData('during-attach')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(socket.send).toHaveBeenCalledTimes(1)
    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('persists terminal titles on the server and broadcasts title updates', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')

    const attached = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })

    expect(attached.ok).toBe(true)
    mockPtys[0]?.emitData('\u001b]0;~/Developer/goblin — npm run dev\u0007')
    await vi.waitFor(async () => {
      const titleMessage = socket.send.mock.calls
        .map(([payload]) => JSON.parse(String(payload)))
        .find((message) => message.type === 'title')
      expect(titleMessage).toMatchObject({
        type: 'title',
        event: {
          sessionId,
          canonicalTitle: '~/Developer/goblin — npm run dev',
        },
      })
      await expect(listServerTerminalSessions('client_1', '/repo')).resolves.toEqual([
        expect.objectContaining({
          sessionId,
          canonicalTitle: '~/Developer/goblin — npm run dev',
        }),
      ])
    })

    const reattached = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })
    expect(reattached).toMatchObject({
      ok: true,
      sessionId,
      canonicalTitle: '~/Developer/goblin — npm run dev',
    })

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('keeps sessions alive during the reconnect grace period and reuses them after a second attach', async () => {
    const socketA = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    const sessionId = await createTerminalSession('client_1')

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)

    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
    mockPtys[0]?.emitData('\u001b[?1049hhello')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const socketB = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_b', socketB)
    const attachedAgain = await attachServerTerminal('client_1', {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_b',
    })

    expect(attachedAgain.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    if (!first.ok || !attachedAgain.ok) return
    expect(attachedAgain.sessionId).toBe(first.sessionId)
    // The server is the source of truth for the buffer; the size
    // change resizes the pty but does not wipe the replay.
    expect(attachedAgain.snapshot).toContain('\u001b[?1049h')
    expect(attachedAgain.snapshot).toContain('hello')
    expect(attachedAgain.snapshotSeq).toBe(1)
    expect(mockPtys[0]?.resize).toHaveBeenCalledWith(100, 30)
    // The new socket must not receive a duplicate replay of the
    // pre-detach data — the snapshot is the single source of truth.
    const replayDuplicateOnNewSocket = socketB.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .some(
        (message) =>
          message.type === 'output' && typeof message.event?.data === 'string' && message.event.data.includes('hello'),
      )
    expect(replayDuplicateOnNewSocket).toBe(false)

    mockPtys[0]?.emitData('resumed')
    const outputMessage = socketB.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'output')
    expect(outputMessage).toMatchObject({
      type: 'output',
      event: { sessionId: first.sessionId, data: 'resumed', seq: 2, processName: 'zsh' },
    })

    unregisterTerminalSocket('client_1', 'attachment_b', socketB)
  })

  // Regression: the previous design carried a separate snapshot
  // (canonical, from a headless xterm) and a replay (recent bytes
  // from a buffer); the client would merge them, and a SIGWINCH
  // re-paint arriving after the attach response could land as a
  // duplicate prompt. The buffer-only design collapses replay and
  // snapshot, so the re-paint must come through the live `output`
  // channel and the snapshot must NOT already contain it.
  test('SIGWINCH re-paint arriving after attach streams in as a live output event', async () => {
    const socketA = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    const sessionId = await createTerminalSession('client_1')

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)

    mockPtys[0]?.emitData('original-prompt\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
    const socketB = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_b', socketB)

    const reattached = await attachServerTerminal('client_1', {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_b',
    })
    expect(reattached.ok).toBe(true)
    if (!reattached.ok) return
    // Snapshot contains the pre-resize content but not the re-paint.
    expect(reattached.snapshot).toContain('original-prompt')
    expect(reattached.snapshot).not.toContain('repainted-at-100x30')

    // The shell re-paints at the new size. This arrives as a live
    // `output` event on the new socket, not folded into the attach
    // snapshot.
    mockPtys[0]?.emitData('\x1b[2Jrepainted-at-100x30')
    const liveOutput = socketB.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find(
        (message) =>
          message.type === 'output' &&
          typeof message.event?.data === 'string' &&
          message.event.data.includes('repainted-at-100x30'),
      )
    expect(liveOutput).toMatchObject({
      type: 'output',
      event: {
        sessionId,
        data: '\x1b[2Jrepainted-at-100x30',
        processName: 'zsh',
      },
    })
    expect(liveOutput.event.seq).toBeGreaterThan(reattached.snapshotSeq ?? 0)

    unregisterTerminalSocket('client_1', 'attachment_b', socketB)
  })

  // Pin the load-bearing contract of the buffer-only design: the
  // attach response's `replay` and `snapshot` fields are the same
  // string, and `replaySeq` equals `snapshotSeq`. If a future change
  // ever re-introduces a separate snapshot pipeline (e.g. a serialize
  // step for "performance"), the client dedup boundary would break.
  test('attach response: replay === snapshot and replaySeq === snapshotSeq', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')

    mockPtys[0]?.emitData('user@host ~ % ls\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const result = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot).toBe(result.replay)
    expect(result.snapshotSeq).toBe(result.replaySeq)

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  // The unit test for the parser covers `\x1b]0;\x07` clearing the
  // title. This wire-level test confirms the broadcast path picks
  // up the null title (and the first-chunk filter in the onData
  // handler does not suppress it).
  test('OSC 0 empty string broadcasts a canonicalTitle: null title event', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')

    const attached = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })
    expect(attached.ok).toBe(true)

    mockPtys[0]?.emitData('\x1b]0;a title\x07')
    await vi.waitFor(() => {
      const messages = socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
      expect(messages.some((message) => message.type === 'title' && message.event?.canonicalTitle === 'a title')).toBe(
        true,
      )
    })

    mockPtys[0]?.emitData('\x1b]0;\x07')
    await vi.waitFor(() => {
      const messages = socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
      expect(messages.some((message) => message.type === 'title' && message.event?.canonicalTitle === null)).toBe(true)
    })

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('attaching a different view after controller disconnect does not take control implicitly', async () => {
    vi.useFakeTimers()
    const socketA = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    const sessionId = await createTerminalSession('client_1')

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
    await vi.advanceTimersByTimeAsync(30_000 + 1)

    const socketB = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_b', socketB)
    const attachedAgain = await attachServerTerminal('client_1', {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_b',
    })

    expect(attachedAgain.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    if (!attachedAgain.ok) return
    expect(attachedAgain.sessionId).toBe(first.sessionId)
    expect(attachedAgain.controller).toBeNull()
    expect(attachedAgain.canonicalCols).toBe(80)
    expect(attachedAgain.canonicalRows).toBe(24)
    expect(mockPtys[0]?.resize).not.toHaveBeenCalledWith(100, 30)

    unregisterTerminalSocket('client_1', 'attachment_b', socketB)
  })

  test('claims control when the first attachment socket connects after attach completes', async () => {
    const sessionId = await createTerminalSession('client_1')

    const attached = await attachServerTerminal('client_1', {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_a',
    })

    expect(attached.ok).toBe(true)
    if (!attached.ok) return
    expect(attached.controller).toBeNull()
    expect(attached.canonicalCols).toBe(80)
    expect(attached.canonicalRows).toBe(24)
    expect(mockPtys[0]?.resize).not.toHaveBeenCalledWith(100, 30)

    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)

    await expect(listServerTerminalSessions('client_1', '/repo')).resolves.toEqual([
      expect.objectContaining({
        sessionId,
        controller: { attachmentId: 'attachment_a', status: 'connected' },
        cols: 100,
        rows: 30,
      }),
    ])
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(100, 30)
    expect(
      socket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return (
          parsed.type === 'ownership' &&
          parsed.event.sessionId === sessionId &&
          parsed.event.controller?.attachmentId === 'attachment_a' &&
          parsed.event.controller?.status === 'connected' &&
          parsed.event.cols === 100 &&
          parsed.event.rows === 30
        )
      }),
    ).toBe(true)

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('broadcasts terminal events to all sockets registered for the same web terminal client id', async () => {
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    registerTerminalSocket('client_1', 'attachment_b', socketB)
    const sessionId = await createTerminalSession('client_1')

    const result = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    mockPtys[0]?.emitData('hello')
    expect(socketA.close).not.toHaveBeenCalled()
    expect(socketB.close).not.toHaveBeenCalled()
    expect(socketA.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'output')).toBe(true)
    expect(socketB.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'output')).toBe(true)
    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
    unregisterTerminalSocket('client_1', 'attachment_b', socketB)
  })

  test('restarts an existing session by session id without creating a second terminal record', async () => {
    const sessionId = await createTerminalSession('client_1')
    const attached = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(attached.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)

    const restarted = await restartServerTerminal('client_1', {
      sessionId,
      cols: 100,
      rows: 30,
      attachmentId: 'attachment_a',
    })

    expect(restarted.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
    if (!restarted.ok) return
    expect(restarted.sessionId).toBe(sessionId)
    await expect(listServerTerminalSessions('client_1', '/repo')).resolves.toEqual([
      expect.objectContaining({ sessionId, cols: 100, rows: 30 }),
    ])
  })

  test('lists repo sessions across clients and broadcasts lifecycle invalidations globally', async () => {
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    registerTerminalSocket('client_2', 'attachment_b', socketB)
    const sessionId = await createTerminalSession('client_1')

    const result = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    await expect(listServerTerminalSessions('client_2', '/repo')).resolves.toEqual([
      expect.objectContaining({
        sessionId: expect.any(String),
        key: '/repo\u0000/repo-linked\u0000terminal-1',
        cwd: path.resolve('/repo-linked'),
        processName: 'zsh',
        cols: 80,
        rows: 24,
      }),
    ])
    if (!result.ok) throw new Error('expected terminal attach to succeed')
    // Emit some PTY output so the session has a non-empty buffer to snapshot.
    mockPtys[0]?.emitData('\x1b]0;~/Developer/goblin — npm run dev\x07')
    mockPtys[0]?.emitData('user@host ~ % ls\n')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const snapshot = getServerTerminalSessionSnapshot('client_2', { sessionId: result.sessionId })
    expect(snapshot).toEqual(
      expect.objectContaining({
        sessionId: result.sessionId,
        snapshot: expect.stringContaining('user@host ~ % ls'),
        snapshotSeq: 2,
      }),
    )
    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    mockPtys[0]?.emitExit()
    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.repoRoot === '/repo'
      }),
    ).toBe(true)

    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
    unregisterTerminalSocket('client_2', 'attachment_b', socketB)
  })

  test('cleans up disconnected sessions after the reconnect grace period elapses', async () => {
    vi.useFakeTimers()
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_b', socket2)
    const recreatedSessionId = await createTerminalSession('client_1')
    const replacementAttach = await attachServerTerminal('client_1', {
      sessionId: recreatedSessionId,
      cols: 80,
      rows: 24,
    })

    expect(replacementAttach.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.sessionId).not.toBe(first.sessionId)

    unregisterTerminalSocket('client_1', 'attachment_b', socket2)
  })

  test('keeps inactive attachments from stealing terminal size until they become active again', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1')

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(first.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(
      resizeServerTerminal('client_1', {
        sessionId: first.ok ? first.sessionId : '',
        cols: 90,
        rows: 28,
        attachmentId: 'attachment_a',
      }),
    ).toBe(true)
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(90, 28)

    const second = await attachServerTerminal('client_1', {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })
    expect(second.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(90, 28)

    if (!first.ok || !second.ok) return
    expect(
      resizeServerTerminal('client_1', {
        sessionId: first.sessionId,
        cols: 120,
        rows: 40,
        attachmentId: 'attachment_b',
      }),
    ).toBe(false)
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(90, 28)

    expect(
      writeServerTerminal('client_1', { sessionId: first.sessionId, data: 'ls', attachmentId: 'attachment_b' }),
    ).toBe(false)
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(90, 28)

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('reports canonical attachment state when another attachment joins without taking control', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1', { cols: 90, rows: 28 })

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 90,
      rows: 28,
      attachmentId: 'attachment_a',
    })
    const second = await attachServerTerminal('client_1', {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.controller).toEqual({ attachmentId: 'attachment_a', status: 'connected' })
    expect(second.canonicalCols).toBe(90)
    expect(second.canonicalRows).toBe(28)
    expect(mockPtys[0]?.resize).not.toHaveBeenCalledWith(120, 40)

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })

  test('takeover returns authoritative ownership snapshot from the server', async () => {
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    const sessionId = await createTerminalSession('client_1')
    registerTerminalSocket('client_1', 'attachment_b', socketB)

    const result = takeoverServerTerminal('client_1', {
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

    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
    unregisterTerminalSocket('client_1', 'attachment_b', socketB)
  })

  test('takeover from a disconnected attachment does not steal control or resize canonical size', async () => {
    const socketA = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socketA)
    const sessionId = await createTerminalSession('client_1')

    const first = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(first.ok).toBe(true)

    const joined = await attachServerTerminal('client_1', {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })
    expect(joined.ok).toBe(true)
    expect(mockPtys[0]?.resize).not.toHaveBeenCalledWith(120, 40)

    const result = takeoverServerTerminal('client_1', {
      sessionId,
      cols: 120,
      rows: 40,
      attachmentId: 'attachment_b',
    })

    expect(result).toEqual({
      ok: true,
      sessionId,
      controller: { attachmentId: 'attachment_a', status: 'connected' },
      canonicalCols: 80,
      canonicalRows: 24,
    })
    expect(mockPtys[0]?.resize).not.toHaveBeenCalledWith(120, 40)

    unregisterTerminalSocket('client_1', 'attachment_a', socketA)
  })

  test('batches rapid writes into a single ordered pty write via the input queue', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerTerminalSocket('client_1', 'attachment_a', socket)
    const sessionId = await createTerminalSession('client_1', { cols: 80, rows: 24 })

    const attach = await attachServerTerminal('client_1', {
      sessionId,
      cols: 80,
      rows: 24,
      attachmentId: 'attachment_a',
    })
    expect(attach.ok).toBe(true)

    writeServerTerminal('client_1', { sessionId, data: 'c', attachmentId: 'attachment_a' })
    writeServerTerminal('client_1', { sessionId, data: 'l', attachmentId: 'attachment_a' })
    writeServerTerminal('client_1', { sessionId, data: 'e', attachmentId: 'attachment_a' })
    writeServerTerminal('client_1', { sessionId, data: 'a', attachmentId: 'attachment_a' })
    writeServerTerminal('client_1', { sessionId, data: 'r', attachmentId: 'attachment_a' })

    // Flush is scheduled as a microtask, so pty.write has not been called yet.
    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    // All rapid writes are batched into a single ordered pty.write call.
    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')

    unregisterTerminalSocket('client_1', 'attachment_a', socket)
  })
})
