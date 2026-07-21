// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalWriteFailureReporter } from '#/web/components/terminal/terminal-write-failure-feedback.ts'
import {
  ClientRealtimeRequestError,
  createClientRealtimeSocketConnection,
} from '#/web/realtime/client-realtime-socket-connection.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

const mocks = vi.hoisted(() => ({ warning: vi.fn() }))
let wsMock: WebSocketMockHandle

vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }))
vi.mock('i18next', () => ({ t: (key: string) => key }))

describe('terminal write failure feedback', () => {
  beforeEach(() => {
    mocks.warning.mockClear()
    wsMock = installWebSocketMock({ autoOpen: false })
  })

  afterEach(() => vi.useRealTimers())

  test('deduplicates failures from the same realtime outage across sessions', () => {
    const reporter = createTerminalWriteFailureReporter()
    const first = new ClientRealtimeRequestError('closed', {
      kind: 'disconnected',
      delivery: 'indeterminate',
      outageId: 4,
    })
    const repeated = new ClientRealtimeRequestError('still closed', {
      kind: 'open-failed',
      delivery: 'not-sent',
      outageId: 4,
    })

    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: { kind: 'error', error: first },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_second_123456',
      failure: { kind: 'error', error: repeated },
    })

    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning).toHaveBeenCalledWith('terminal.write-delivery-uncertain', {
      id: 'terminal-write-failure:terminal.write-delivery-uncertain',
    })
  })

  test('reports a later outage independently and distinguishes definite rejection', () => {
    const reporter = createTerminalWriteFailureReporter()
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: {
        kind: 'error',
        error: new ClientRealtimeRequestError('unavailable', {
          kind: 'unavailable',
          delivery: 'not-sent',
          outageId: 1,
        }),
      },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: {
        kind: 'error',
        error: new ClientRealtimeRequestError('unavailable again', {
          kind: 'unavailable',
          delivery: 'not-sent',
          outageId: 2,
        }),
      },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: { kind: 'result', result: { status: 'rejected' } },
    })

    expect(mocks.warning.mock.calls).toEqual([
      ['terminal.write-not-sent', { id: 'terminal-write-failure:terminal.write-not-sent' }],
      ['terminal.write-not-sent', { id: 'terminal-write-failure:terminal.write-not-sent' }],
      ['terminal.write-blocked-rejected', { id: 'terminal-write-failure:terminal.write-blocked-rejected' }],
    ])
  })

  test('does not report shutdown as an outage', () => {
    const reporter = createTerminalWriteFailureReporter()
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: {
        kind: 'error',
        error: new ClientRealtimeRequestError('closed', {
          kind: 'app-quitting',
          delivery: 'indeterminate',
          outageId: null,
        }),
      },
    })

    expect(mocks.warning).not.toHaveBeenCalled()
  })

  test('does not re-report a delayed failure from an older outage', () => {
    const reporter = createTerminalWriteFailureReporter()
    for (const outageId of [2, 1]) {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_first_123456',
        failure: {
          kind: 'error',
          error: new ClientRealtimeRequestError('closed', {
            kind: 'disconnected',
            delivery: 'indeterminate',
            outageId,
          }),
        },
      })
    }

    expect(mocks.warning).toHaveBeenCalledTimes(1)
  })

  test('reports one uncertain-delivery warning when a health probe drops pending terminal writes', async () => {
    vi.useFakeTimers()
    let requestSequence = 0
    const connection = createClientRealtimeSocketConnection<
      { write: { data: string } },
      { write: { status: 'accepted' } },
      never
    >({
      resolveConnection: () => ({ url: 'ws://example.test/ws/app', clientId: 'client_test' }),
      hasRealtimeSubscribers: () => true,
      onRealtimeMessage: () => {},
      parseServerMessage: (data) => JSON.parse(String(data)) as { type: 'pong'; requestId: string },
      encodeClientMessage: JSON.stringify,
      createRequestId: () => `request_${++requestSequence}`,
      errorPrefix: 'App realtime',
    })
    connection.openForRealtime()
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')
    socket.emitOpen()
    const reporter = createTerminalWriteFailureReporter()
    const first = connection.request('write', { data: 'a' }).catch((error: unknown) => {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_first_123456',
        failure: { kind: 'error', error },
      })
    })
    const second = connection.request('write', { data: 'b' }).catch((error: unknown) => {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_second_123456',
        failure: { kind: 'error', error },
      })
    })
    await Promise.resolve()

    connection.kickReconnect()
    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([first, second])

    expect(socket.readyState).toBe(wsMock.CLOSED)
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning).toHaveBeenCalledWith('terminal.write-delivery-uncertain', {
      id: 'terminal-write-failure:terminal.write-delivery-uncertain',
    })
  })

  test('reports an in-flight uncertain write before later not-sent writes from the same outage', async () => {
    let requestSequence = 0
    const connection = createClientRealtimeSocketConnection<
      { write: { data: string } },
      { write: { status: 'accepted' } },
      never
    >({
      resolveConnection: () => ({ url: 'ws://example.test/ws/app', clientId: 'client_test' }),
      hasRealtimeSubscribers: () => true,
      onRealtimeMessage: () => {},
      parseServerMessage: (data) => JSON.parse(String(data)) as { type: 'pong'; requestId: string },
      encodeClientMessage: JSON.stringify,
      createRequestId: () => `request_${++requestSequence}`,
      errorPrefix: 'App realtime',
    })
    connection.openForRealtime()
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing socket')
    firstSocket.emitOpen()
    const reporter = createTerminalWriteFailureReporter()
    const inFlight = connection.request('write', { data: 'a' }).catch((error: unknown) => {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_first_123456',
        failure: { kind: 'error', error },
      })
    })
    await Promise.resolve()

    firstSocket.emitError()
    const notSent = connection.request('write', { data: 'b' }).catch((error: unknown) => {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_second_123456',
        failure: { kind: 'error', error },
      })
    })
    wsMock.instances[1]?.close()
    await Promise.all([inFlight, notSent])

    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning).toHaveBeenCalledWith('terminal.write-delivery-uncertain', {
      id: 'terminal-write-failure:terminal.write-delivery-uncertain',
    })
  })

  test('uses a stable semantic toast identity for repeated PTY result failures', () => {
    const reporter = createTerminalWriteFailureReporter()
    const reportRejected = () =>
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_first_123456',
        failure: { kind: 'result', result: { status: 'rejected' } },
      })

    reportRejected()
    reportRejected()
    expect(mocks.warning).toHaveBeenCalledTimes(2)
    expect(mocks.warning).toHaveBeenLastCalledWith('terminal.write-blocked-rejected', {
      id: 'terminal-write-failure:terminal.write-blocked-rejected',
    })
  })

  test('uses one stable toast identity for PTY failures across durable sessions', () => {
    const reporter = createTerminalWriteFailureReporter()
    for (const terminalSessionId of ['term-first', 'term-second']) {
      reporter.report({
        terminalRuntimeSessionId: `pty_${terminalSessionId}`,
        failure: { kind: 'result', result: { status: 'indeterminate' } },
      })
    }

    expect(mocks.warning).toHaveBeenCalledTimes(2)
    expect(mocks.warning).toHaveBeenNthCalledWith(1, 'terminal.write-delivery-uncertain', {
      id: 'terminal-write-failure:terminal.write-delivery-uncertain',
    })
    expect(mocks.warning).toHaveBeenNthCalledWith(2, 'terminal.write-delivery-uncertain', {
      id: 'terminal-write-failure:terminal.write-delivery-uncertain',
    })
  })
})
