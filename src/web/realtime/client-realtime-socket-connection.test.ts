// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createClientRealtimeSocketConnection } from '#/web/realtime/client-realtime-socket-connection.ts'
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
})

function createTestConnection(options: {
  onRealtimeMessage: (message: TestRealtimeMessage, currentClientId: string) => void
  hasRealtimeSubscribers?: () => boolean
  onOpen?: (currentClientId: string) => void
}) {
  return createClientRealtimeSocketConnection<TestInputs, TestOutputs, TestServerMessage, TestRealtimeMessage>({
    resolveConnection: () => ({ url: 'ws://example.test/ws/realtime', clientId: 'client_realtime' }),
    hasRealtimeSubscribers: options.hasRealtimeSubscribers ?? (() => false),
    onRealtimeMessage: options.onRealtimeMessage,
    onOpen: options.onOpen,
    parseServerMessage(data) {
      if (typeof data !== 'string') return null
      return JSON.parse(data) as TestServerMessage
    },
    encodeClientMessage(message) {
      return JSON.stringify(message)
    },
    createRequestId: () => 'req_test',
    errorPrefix: 'Test',
  })
}
