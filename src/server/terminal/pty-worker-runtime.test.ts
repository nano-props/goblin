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

function buildRuntime(options: { spawnPty?: ConstructorParameters<typeof PtyWorkerRuntime>[0]['spawnPty'] } = {}) {
  const emitted: PtyWorkerMessage[] = []
  const runtime = new PtyWorkerRuntime({
    spawnPty: options.spawnPty,
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
  test('pty-spawn returns a ptySessionId and a placeholder process name', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req_1', input: { cwd: '/repo', cols: 80, rows: 24 } })

    const result = emitted.find((m) => m.type === 'pty-spawn-result' && m.requestId === 'req_1')
    expect(result).toMatchObject({
      type: 'pty-spawn-result',
      requestId: 'req_1',
      ok: true,
      ptySessionId: expect.stringMatching(/^pty-/),
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
    const ptySessionId = (
      emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { ptySessionId: string } | undefined
    )?.ptySessionId
    if (!ptySessionId) throw new Error('no session id')

    pty.emitData('hello')

    const nameChanges = emitted.filter((m) => m.type === 'pty-process-name-changed')
    expect(nameChanges).toEqual([{ type: 'pty-process-name-changed', ptySessionId, processName: 'zsh' }])
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

  test('pty-spawn surfaces a structured recoverable failure for posix_spawnp failures', () => {
    const { runtime, emitted } = buildRuntime({
      spawnPty: () => ({ ok: false, message: 'posix_spawnp failed' }),
    })
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const result = emitted.find((m) => m.type === 'pty-spawn-result' && m.requestId === 'req')
    expect(result).toEqual({
      type: 'pty-spawn-result',
      requestId: 'req',
      ok: false,
      error: 'posix_spawnp failed',
      failure: { code: 'native-pty-spawn-failed', recoverable: true },
    })
  })

  test('pty-spawn surfaces a structured nonrecoverable failure for unknown spawn failures', () => {
    const { runtime, emitted } = buildRuntime({
      spawnPty: () => ({ ok: false, message: 'shell not found' }),
    })
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const result = emitted.find((m) => m.type === 'pty-spawn-result' && m.requestId === 'req')
    expect(result).toEqual({
      type: 'pty-spawn-result',
      requestId: 'req',
      ok: false,
      error: 'shell not found',
      failure: { code: 'unknown', recoverable: false },
    })
  })

  test('pty-write, pty-resize, pty-kill route to the matching pty', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    expect(pty).toBeDefined()
    if (!pty) return
    const ptySessionId = (
      emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { ptySessionId: string } | undefined
    )?.ptySessionId
    expect(ptySessionId).toBeDefined()
    if (!ptySessionId) return
    runtime.handleMessage({ type: 'pty-write', requestId: 'write_1', ptySessionId, data: 'ls\n' })
    runtime.handleMessage({ type: 'pty-resize', ptySessionId, cols: 100, rows: 30 })
    runtime.handleMessage({ type: 'pty-kill', ptySessionId })

    expect(pty.write).toHaveBeenCalledWith('ls\n')
    expect(emitted).toContainEqual({ type: 'pty-write-result', requestId: 'write_1', status: 'accepted' })
    expect(pty.resize).toHaveBeenCalledWith(100, 30)
    expect(pty.kill).toHaveBeenCalledTimes(1)
  })

  test('rejects a write for an unknown PTY', () => {
    const { runtime, emitted } = buildRuntime()

    runtime.handleMessage({ type: 'pty-write', requestId: 'write_missing', ptySessionId: 'pty_missing', data: 'x' })

    expect(emitted).toEqual([{ type: 'pty-write-result', requestId: 'write_missing', status: 'rejected' }])
  })

  test('marks a throwing PTY write as indeterminate', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'spawn_1', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    if (!pty) throw new Error('missing PTY')
    const spawn = emitted.find((message) => message.type === 'pty-spawn-result' && message.ok)
    if (!spawn || spawn.type !== 'pty-spawn-result' || !spawn.ok) throw new Error('missing spawn result')
    pty.write.mockImplementationOnce(() => {
      throw new Error('write failed')
    })

    runtime.handleMessage({
      type: 'pty-write',
      requestId: 'write_1',
      ptySessionId: spawn.ptySessionId,
      data: 'x',
    })

    expect(emitted).toContainEqual({ type: 'pty-write-result', requestId: 'write_1', status: 'indeterminate' })
  })

  test('emits pty-data and pty-exit for live sessions', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const pty = mockPtys[0]
    if (!pty) throw new Error('no pty')
    const ptySessionId = (
      emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { ptySessionId: string } | undefined
    )?.ptySessionId
    expect(ptySessionId).toBeDefined()
    if (!ptySessionId) return

    pty.emitData('hello')
    pty.emitExit()

    expect(emitted.filter((m) => m.type === 'pty-data')).toEqual([{ type: 'pty-data', ptySessionId, data: 'hello' }])
    expect(emitted.filter((m) => m.type === 'pty-exit')).toEqual([
      { type: 'pty-exit', ptySessionId, code: null, signal: null },
    ])
  })

  test('emits a title-OSC-driven process-name change on subsequent data chunks', () => {
    const { runtime, emitted } = buildRuntime()
    runtime.handleMessage({ type: 'pty-spawn', requestId: 'req', input: { cwd: '/repo', cols: 80, rows: 24 } })
    const ptySessionId = (
      emitted.find((m) => m.type === 'pty-spawn-result' && m.ok) as { ptySessionId: string } | undefined
    )?.ptySessionId
    if (!ptySessionId) throw new Error('no session id')

    const pty = mockPtys[0]
    if (!pty) throw new Error('no pty')
    pty.emitData('plain-output')
    pty.setProcessName('vim')
    pty.emitData('\x1b]0;vim\x07')
    const nameChanges = emitted.filter((m) => m.type === 'pty-process-name-changed')
    expect(nameChanges).toEqual([
      { type: 'pty-process-name-changed', ptySessionId, processName: 'zsh' },
      { type: 'pty-process-name-changed', ptySessionId, processName: 'vim' },
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
