import { describe, expect, test, vi } from 'vitest'
import { TerminalWorkerRuntime } from '#/server/terminal/terminal-worker-runtime.ts'
import type { TerminalFacade } from '#/server/terminal/terminal-facade.ts'
import type { TerminalWorkerMessage } from '#/server/terminal/terminal-worker-protocol.ts'

function createTerminalFacadeStub(): TerminalFacade {
  return {
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    attach: vi.fn(async () => ({
      ok: true as const,
      sessionId: 'term_123456789012',
      replay: '',
      replaySeq: 0,
      replayTruncated: false,
      processName: 'zsh',
      canonicalTitle: null,
      controller: null,
      canonicalCols: 80,
      canonicalRows: 24,
    })),
    restart: vi.fn(async () => ({
      ok: true as const,
      sessionId: 'term_123456789012',
      replay: '',
      replaySeq: 0,
      replayTruncated: false,
      processName: 'zsh',
      canonicalTitle: null,
      controller: null,
      canonicalCols: 80,
      canonicalRows: 24,
    })),
    write: vi.fn(() => true),
    resize: vi.fn(() => true),
    takeover: vi.fn(() => ({
      ok: true as const,
      sessionId: 'term_123456789012',
      controller: null,
      canonicalCols: 80,
      canonicalRows: 24,
    })),
    close: vi.fn(() => true),
    notifyBell: vi.fn(() => true),
    listSessions: vi.fn(async () => []),
    create: vi.fn(async () => ({
      ok: true as const,
      action: 'created' as const,
      key: '/repo\0/wt\0terminal-1',
      sessions: [],
    })),
    prune: vi.fn(async () => ({ pruned: 1, remaining: 0 })),
    getSessionSnapshot: vi.fn(async () => null),
    reorder: vi.fn(() => true),
    handleRealtimeMessage: vi.fn(),
    shutdown: vi.fn(),
  }
}

describe('terminal worker runtime', () => {
  test('dispatches requests through the terminal facade and emits responses', async () => {
    const service = createTerminalFacadeStub()
    const emitted: TerminalWorkerMessage[] = []
    const runtime = new TerminalWorkerRuntime({
      service,
      emit(message) {
        emitted.push(message)
      },
      exit: vi.fn(),
    })

    await runtime.handleMessage({
      type: 'request',
      requestId: 'req_1',
      action: 'write',
      clientId: 'client_1',
      input: { sessionId: 'term_123456789012', data: 'pwd', attachmentId: 'attachment_a' },
    })

    expect(service.write).toHaveBeenCalledWith('client_1', {
      sessionId: 'term_123456789012',
      data: 'pwd',
      attachmentId: 'attachment_a',
    })
    expect(emitted).toEqual([{ type: 'response', requestId: 'req_1', ok: true, payload: true }])
  })

  test('proxies socket messages through the transport emitter', async () => {
    const service = createTerminalFacadeStub()
    const emitted: TerminalWorkerMessage[] = []
    const runtime = new TerminalWorkerRuntime({
      service,
      emit(message) {
        emitted.push(message)
      },
      exit: vi.fn(),
    })

    await runtime.handleMessage({
      type: 'socket-register',
      socketId: 'socket_1',
      clientId: 'client_1',
      attachmentId: 'attachment_a',
    })

    const socket = vi.mocked(service.registerSocket).mock.calls[0]?.[2]
    socket?.send('hello')
    socket?.close(1000, 'done')

    expect(emitted).toEqual([
      { type: 'socket-send', socketId: 'socket_1', payload: 'hello' },
      { type: 'socket-close', socketId: 'socket_1', code: 1000, reason: 'done' },
    ])
  })

  test('forwards socket-message to the facade handleRealtimeMessage', async () => {
    const service = createTerminalFacadeStub()
    const runtime = new TerminalWorkerRuntime({
      service,
      emit: vi.fn(),
      exit: vi.fn(),
    })

    await runtime.handleMessage({
      type: 'socket-register',
      socketId: 'socket_1',
      clientId: 'client_1',
      attachmentId: 'attachment_a',
    })

    await runtime.handleMessage({
      type: 'socket-message',
      socketId: 'socket_1',
      clientId: 'client_1',
      attachmentId: 'attachment_a',
      payload: '{"type":"write","sessionId":"term_123","data":"hello"}',
    })

    expect(service.handleRealtimeMessage).toHaveBeenCalledWith(
      'client_1',
      'attachment_a',
      expect.any(Object),
      '{"type":"write","sessionId":"term_123","data":"hello"}',
    )
  })

  test('shuts down the terminal facade and exits on shutdown messages', async () => {
    const service = createTerminalFacadeStub()
    const exit = vi.fn()
    const runtime = new TerminalWorkerRuntime({
      service,
      emit: vi.fn(),
      exit,
    })

    await runtime.handleMessage({ type: 'shutdown' })

    expect(service.shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  test('emits failed responses when a terminal facade action throws', async () => {
    const service = createTerminalFacadeStub()
    vi.mocked(service.write).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const emitted: TerminalWorkerMessage[] = []
    const runtime = new TerminalWorkerRuntime({
      service,
      emit(message) {
        emitted.push(message)
      },
      exit: vi.fn(),
    })

    await runtime.handleMessage({
      type: 'request',
      requestId: 'req_fail',
      action: 'write',
      clientId: 'client_1',
      input: { sessionId: 'term_123456789012', data: 'pwd', attachmentId: 'attachment_a' },
    })

    expect(emitted).toEqual([{ type: 'response', requestId: 'req_fail', ok: false, error: 'boom' }])
  })
})
