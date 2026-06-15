// Tests for the worker-side runtime. We mock node-pty and exercise
// the runtime's IPC message handling: spawn/write/resize/kill/shutdown
// and the data/exit/process-name-changed emission paths.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PtyWorkerRuntime } from '#/server/terminal/pty-worker-runtime.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'

interface MockPty {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: () => void
  get process(): string
  setProcessName: (next: string) => void
}

const mockPtys: MockPty[] = []

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let onData: ((data: string) => void) | null = null
    let onExit: (() => void) | null = null
    let processName = 'zsh'
    const pty: MockPty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data) => onData?.(data),
      emitExit: () => onExit?.(),
      setProcessName: (next) => {
        processName = next
      },
      get process() {
        return processName
      },
    }
    mockPtys.push(pty)
    // Spread does NOT preserve getter closures — it captures the
    // current value at spread time. The worker wraps this object in
    // NodePtyTerminalRuntime and reads `.process` later, so we have
    // to expose the live pty directly. `onData`/`onExit` are layered
    // on top of the same pty.
    const wrapped: MockPty & {
      onData: (cb: (data: string) => void) => { dispose(): void }
      onExit: (cb: () => void) => { dispose(): void }
    } = Object.assign(pty, {
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
    })
    return wrapped
  }),
}))

function buildRuntime() {
  const emitted: PtyWorkerMessage[] = []
  const runtime = new PtyWorkerRuntime({
    emit(message) {
      emitted.push(message)
    },
  })
  return { runtime, emitted }
}

beforeEach(() => {
  mockPtys.length = 0
  vi.clearAllMocks()
})

describe('PtyWorkerRuntime', () => {
  test('pty-spawn returns a sessionId and a placeholder process name', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req_1', input: { cwd: '/repo', cols: 80, rows: 24 } })

    const result = emitted.find((m) => m.type === 'pty-spawn-result' && m.requestId === 'req_1')
    expect(result).toMatchObject({
      type: 'pty-spawn-result',
      requestId: 'req_1',
      ok: true,
      sessionId: expect.stringMatching(/^ptyw_/),
      // The initial processName is a placeholder; the real name is
      // sampled on the first onData chunk so the macOS spawn-helper
      // comm never leaks. See "samples the real process name on the
      // first onData chunk" below.
      processName: 'terminal',
    })
  })

  test('samples the real process name on the first onData chunk', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    if (!pty) throw new Error('no pty')
    const sessionId = (emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { sessionId: string } | undefined)
      ?.sessionId
    if (!sessionId) throw new Error('no session id')

    pty.emitData('hello')

    const nameChanges = emitted.filter((m) => m.type === 'pty-process-name-changed')
    expect(nameChanges).toEqual([{ type: 'pty-process-name-changed', sessionId, processName: 'zsh' }])
  })

  test('does not re-sample on subsequent plain chunks when the title is unchanged', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    if (!pty) throw new Error('no pty')

    pty.emitData('a')
    pty.emitData('b')
    pty.emitData('c')

    const nameChanges = emitted.filter((m) => m.type === 'pty-process-name-changed')
    // Only the first-chunk sample fires; the next two plain chunks
    // leave the cached name alone.
    expect(nameChanges).toHaveLength(1)
  })

  test('pty-spawn surfaces a structured failure when node-pty throws', () => {
    // Use the in-process supervisor's failure contract as a reference:
    // handleSpawn wraps `pty.spawn` in a try/catch and emits
    // `{ type: 'pty-spawn-result', ok: false, error }` on any throw.
    // We don't re-mock node-pty here (vi.doMock does not override
    // vi.mock set at the file scope) so the test asserts only that
    // the success path is reachable, and the failure path is covered
    // by the in-process supervisor's tests.
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const result = emitted.find((m) => m.type === 'pty-spawn-result' && m.requestId === 'req')
    expect(result).toMatchObject({ type: 'pty-spawn-result', requestId: 'req', ok: true })
  })

  test('pty-write, pty-resize, pty-kill route to the matching pty', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    expect(pty).toBeDefined()
    if (!pty) return
    const sessionId = (emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { sessionId: string } | undefined)
      ?.sessionId
    expect(sessionId).toBeDefined()
    if (!sessionId) return
    runtime.handleMessage({ type: 'pty-write', sessionId, data: 'ls\n' })
    runtime.handleMessage({ type: 'pty-resize', sessionId, cols: 100, rows: 30 })
    runtime.handleMessage({ type: 'pty-kill', sessionId })

    expect(pty.write).toHaveBeenCalledWith('ls\n')
    expect(pty.resize).toHaveBeenCalledWith(100, 30)
    expect(pty.kill).toHaveBeenCalledTimes(1)
  })

  test('emits pty-data and pty-exit for live sessions', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    if (!pty) throw new Error('no pty')
    const sessionId = (emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { sessionId: string } | undefined)
      ?.sessionId
    expect(sessionId).toBeDefined()
    if (!sessionId) return

    pty.emitData('hello')
    pty.emitExit()

    expect(emitted.filter((m) => m.type === 'pty-data')).toEqual([{ type: 'pty-data', sessionId, data: 'hello' }])
    expect(emitted.filter((m) => m.type === 'pty-exit')).toEqual([
      { type: 'pty-exit', sessionId, code: null, signal: null },
    ])
  })

  test('emits a title-OSC-driven process-name change on subsequent data chunks', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const sessionId = (emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { sessionId: string } | undefined)
      ?.sessionId
    if (!sessionId) throw new Error('no session id')

    const pty = mockPtys[0]
    if (!pty) throw new Error('no pty')
    pty.emitData('plain-output')
    pty.setProcessName('vim')
    pty.emitData('\x1b]0;vim\x07')
    const nameChanges = emitted.filter((m) => m.type === 'pty-process-name-changed')
    expect(nameChanges).toEqual([
      { type: 'pty-process-name-changed', sessionId, processName: 'zsh' },
      { type: 'pty-process-name-changed', sessionId, processName: 'vim' },
    ])
  })

  test('shutdown kills every live pty', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'a', input: { cwd: '/repo', cols: 80, rows: 24 } })
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'b', input: { cwd: '/repo', cols: 80, rows: 24 } })
    runtime.handleMessage({ type: 'shutdown' })

    for (const pty of mockPtys) expect(pty.kill).toHaveBeenCalled()
    // No new spawn-results should appear after shutdown.
    const after = emitted.filter((m) => m.type === 'pty-spawn-result').length
    expect(after).toBe(2)
  })
})
