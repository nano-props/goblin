// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ClientRealtimeRequestError,
  createClientRealtimeSocketConnection,
} from '#/web/realtime/client-realtime-socket-connection.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

interface TestInputs {
  echo: { value: string }
}

interface TestOutputs {
  echo: { echoed: string }
}

type TestRealtimeMessage = { type: 'feature.changed'; value: string }

type TestServerMessage =
  | TestRealtimeMessage
  | { type: 'response'; requestId: string; ok: true; action: 'echo'; payload: TestOutputs['echo'] }
  | { type: 'response'; requestId: string; ok: false; action: 'echo'; error: string }
  | { type: 'pong'; requestId: string }

let wsMock: WebSocketMockHandle

describe('client realtime socket connection', () => {
  beforeEach(() => {
    wsMock = installWebSocketMock({ autoOpen: false })
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('sends typed requests and settles matching responses', async () => {
    const onRealtimeMessage = vi.fn()
    const connection = createTestConnection({ onRealtimeMessage })
    const promise = connection.request('echo', { value: 'hello' })
    const socket = wsMock.instances[0]
    socket?.emitOpen()
    await Promise.resolve()

    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'request')
    expect(request).toMatchObject({
      type: 'request',
      action: 'echo',
      input: { value: 'hello' },
    })
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'echo',
        payload: { echoed: 'hello' },
      }),
    )

    await expect(promise).resolves.toEqual({ echoed: 'hello' })
    expect(onRealtimeMessage).not.toHaveBeenCalled()
  })

  test('forwards feature realtime messages and sends heartbeat envelopes', async () => {
    vi.useFakeTimers()
    const onRealtimeMessage = vi.fn()
    const connection = createTestConnection({ onRealtimeMessage, hasRealtimeSubscribers: () => true })
    connection.openForRealtime()
    const socket = wsMock.instances[0]
    socket?.emitOpen()

    socket?.emitMessage(JSON.stringify({ type: 'feature.changed', value: 'fresh' }))
    vi.advanceTimersByTime(30_000)

    expect(onRealtimeMessage).toHaveBeenCalledWith({ type: 'feature.changed', value: 'fresh' }, 'client_realtime')
    expect(socket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({ type: 'heartbeat' })
  })

  test('notifies callers when the socket opens with the current client id', () => {
    const onOpen = vi.fn()
    const connection = createTestConnection({ onRealtimeMessage: vi.fn(), hasRealtimeSubscribers: () => true, onOpen })
    connection.openForRealtime()
    const socket = wsMock.instances[0]

    socket?.emitOpen()

    expect(onOpen).toHaveBeenCalledWith('client_realtime')
  })

  test('does not open for realtime without socket demand', () => {
    const connection = createTestConnection({ onRealtimeMessage: vi.fn() })

    connection.openForRealtime()

    expect(wsMock.instances).toHaveLength(0)
  })

  test('cancels pending reconnect when realtime subscribers drain', () => {
    vi.useFakeTimers()
    let subscribed = true
    const connection = createTestConnection({
      onRealtimeMessage: vi.fn(),
      hasRealtimeSubscribers: () => subscribed,
    })
    connection.openForRealtime()
    const socket = wsMock.instances[0]
    socket?.emitOpen()

    socket?.emitError()
    subscribed = false
    connection.closeSocketIfIdle()
    vi.advanceTimersByTime(300)

    expect(wsMock.instances).toHaveLength(1)
  })

  test('classifies a disconnected in-flight request as indeterminate', async () => {
    const connection = createTestConnection({ onRealtimeMessage: vi.fn(), hasRealtimeSubscribers: () => true })
    const promise = connection.request('echo', { value: 'hello' })
    const socket = wsMock.instances[0]
    socket?.emitOpen()
    await Promise.resolve()

    socket?.emitError()

    await expect(promise).rejects.toMatchObject({
      name: 'ClientRealtimeRequestError',
      kind: 'disconnected',
      delivery: 'indeterminate',
      outageId: 1,
    } satisfies Partial<ClientRealtimeRequestError>)
  })

  test('classifies a synchronous send failure as not sent', async () => {
    const connection = createTestConnection({ onRealtimeMessage: vi.fn(), hasRealtimeSubscribers: () => true })
    connection.openForRealtime()
    const socket = wsMock.instances[0]
    socket?.emitOpen()
    if (!socket) throw new Error('missing socket')
    socket.send = () => {
      throw new Error('send failed')
    }

    await expect(connection.request('echo', { value: 'hello' })).rejects.toMatchObject({
      name: 'ClientRealtimeRequestError',
      kind: 'send-failed',
      delivery: 'not-sent',
      outageId: 1,
    } satisfies Partial<ClientRealtimeRequestError>)
  })

  test('fails encoding before opening a socket or creating an outage', async () => {
    const connection = createTestConnection({
      onRealtimeMessage: vi.fn(),
      encodeClientMessage: () => {
        throw new Error('message too large')
      },
    })

    await expect(connection.request('echo', { value: 'oversized' })).rejects.toMatchObject({
      name: 'ClientRealtimeRequestError',
      message: 'message too large',
      kind: 'send-failed',
      delivery: 'not-sent',
      outageId: null,
    } satisfies Partial<ClientRealtimeRequestError>)
    expect(wsMock.instances).toHaveLength(0)
  })

  test('keeps one outage id across reconnect attempts and advances it after recovery', async () => {
    vi.useFakeTimers()
    const connection = createTestConnection({ onRealtimeMessage: vi.fn(), hasRealtimeSubscribers: () => true })
    connection.openForRealtime()
    wsMock.instances[0]?.emitOpen()
    wsMock.instances[0]?.emitError()
    await vi.advanceTimersByTimeAsync(300)
    expect(wsMock.instances).toHaveLength(2)

    const duringOutage = connection.request('echo', { value: 'during' })
    wsMock.instances[1]?.close()
    await expect(duringOutage).rejects.toMatchObject({ outageId: 1, delivery: 'not-sent' })

    await vi.advanceTimersByTimeAsync(300)
    expect(wsMock.instances).toHaveLength(3)
    wsMock.instances[2]?.emitOpen()
    wsMock.instances[2]?.emitError()
    const nextOutage = connection.request('echo', { value: 'after' })
    wsMock.instances[3]?.close()
    await expect(nextOutage).rejects.toMatchObject({ outageId: 2 })
  })

  test('does not replace a connecting socket while a request is waiting for it to open', async () => {
    const connection = createTestConnection({
      onRealtimeMessage: vi.fn(),
      hasRealtimeSubscribers: () => true,
    })
    const promise = connection.request('echo', { value: 'hello' })
    const socket = wsMock.instances[0]

    connection.kickReconnect()

    expect(socket?.readyState).toBe(wsMock.CONNECTING)
    expect(wsMock.instances).toHaveLength(1)

    socket?.emitOpen()
    await Promise.resolve()

    const request = socket?.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'request')
    socket?.emitMessage(
      JSON.stringify({
        type: 'response',
        requestId: request?.requestId,
        ok: true,
        action: 'echo',
        payload: { echoed: 'hello' },
      }),
    )

    await expect(promise).resolves.toEqual({ echoed: 'hello' })
  })

  test('times out realtime-only sockets that never open', () => {
    vi.useFakeTimers()
    const connection = createTestConnection({
      onRealtimeMessage: vi.fn(),
      hasRealtimeSubscribers: () => true,
    })
    connection.openForRealtime()
    const socket = wsMock.instances[0]

    vi.advanceTimersByTime(10_000)

    expect(socket?.readyState).toBe(wsMock.CLOSED)
    expect(wsMock.instances).toHaveLength(1)

    vi.advanceTimersByTime(300)

    expect(wsMock.instances).toHaveLength(2)
    expect(wsMock.instances[1]?.readyState).toBe(wsMock.CONNECTING)
  })

  test('keeps the open timeout when realtime demand drains before a connecting socket opens', () => {
    vi.useFakeTimers()
    let subscribed = true
    const connection = createTestConnection({
      onRealtimeMessage: vi.fn(),
      hasRealtimeSubscribers: () => subscribed,
    })
    connection.openForRealtime()
    const socket = wsMock.instances[0]

    subscribed = false
    connection.closeSocketIfIdle()
    vi.advanceTimersByTime(10_000)

    expect(socket?.readyState).toBe(wsMock.CLOSED)

    vi.advanceTimersByTime(300)

    expect(wsMock.instances).toHaveLength(1)
  })
})

function createTestConnection(options: {
  onRealtimeMessage: (message: TestRealtimeMessage, currentClientId: string) => void
  hasRealtimeSubscribers?: () => boolean
  onOpen?: (currentClientId: string) => void
  encodeClientMessage?: (message: unknown) => string
}) {
  return createClientRealtimeSocketConnection<TestInputs, TestOutputs, TestRealtimeMessage>({
    resolveConnection: () => ({ url: 'ws://example.test/ws/realtime', clientId: 'client_realtime' }),
    hasRealtimeSubscribers: options.hasRealtimeSubscribers ?? (() => false),
    onRealtimeMessage: options.onRealtimeMessage,
    onOpen: options.onOpen,
    parseServerMessage(data) {
      if (typeof data !== 'string') return null
      return JSON.parse(data) as TestServerMessage
    },
    encodeClientMessage: options.encodeClientMessage ?? JSON.stringify,
    createRequestId: () => 'req_test',
    errorPrefix: 'Test',
  })
}
