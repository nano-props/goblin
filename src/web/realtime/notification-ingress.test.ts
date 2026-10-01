// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

describe('server invalidation ingress', () => {
  let wsMock: WebSocketMockHandle

  beforeEach(() => {
    vi.resetModules()
    wsMock = installWebSocketMock({ autoOpen: false })
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'test-token' },
      },
    })
  })

  afterEach(async () => {
    const { resetServerNotificationIngressForTests } = await import('#/web/realtime/notification-ingress.ts')
    resetServerNotificationIngressForTests()
  })

  test('connects to the invalidation channel and dispatches valid events', async () => {
    const { subscribeServerInvalidationIngress } = await import('#/web/realtime/notification-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerInvalidationIngress(listener)

    expect(wsMock.instances[0]?.url).toContain('/ws/notifications')
    wsMock.instances[0]?.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['theme'] }))

    expect(listener).toHaveBeenCalledWith({ type: 'settings-invalidated', scopes: ['theme'] })
    dispose()
  })

  test('shares one connection and declares client-intent demand as listeners change', async () => {
    const { subscribeServerInvalidationIngress, subscribeServerClientIntentIngress } =
      await import('#/web/realtime/notification-ingress.ts')
    const invalidation = vi.fn()
    const intent = vi.fn()
    const disposeInvalidation = subscribeServerInvalidationIngress(invalidation)
    const socket = wsMock.instances[0]!
    socket.emitOpen()
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'client-intent-subscription', enabled: false })
    const disposeIntent = subscribeServerClientIntentIngress(intent)
    const disposeSecondIntent = subscribeServerClientIntentIngress(() => {})
    expect(wsMock.instances).toHaveLength(1)
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: 'client-intent-subscription', enabled: false },
      { type: 'client-intent-subscription', enabled: true },
    ])
    socket.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['theme'] }))
    socket.emitMessage(
      JSON.stringify({
        type: 'client-effect-intent',
        intent: { type: 'show-workspace-pane-tab-requested', tab: 'changes' },
      }),
    )
    expect(invalidation).toHaveBeenCalledOnce()
    expect(intent).toHaveBeenCalledOnce()
    disposeIntent()
    expect(socket.sent).toHaveLength(2)
    disposeSecondIntent()
    expect(JSON.parse(socket.sent[2]!)).toEqual({ type: 'client-intent-subscription', enabled: false })
    expect(socket.readyState).toBe(wsMock.OPEN)
    disposeInvalidation()
    expect(socket.readyState).toBe(wsMock.CLOSED)
  })

  test('redeclares current demand on reconnect and ignores retired socket events', async () => {
    useFakeTimers()
    const { subscribeServerInvalidationIngress, subscribeServerClientIntentIngress } =
      await import('#/web/realtime/notification-ingress.ts')
    const onOpen = vi.fn()
    const listener = vi.fn()
    const disposeInvalidation = subscribeServerInvalidationIngress(listener, onOpen)
    const disposeIntent = subscribeServerClientIntentIngress(() => {})
    const first = wsMock.instances[0]!
    first.emitOpen()
    expect(first.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: 'client-intent-subscription', enabled: true },
    ])
    first.close()
    await advanceTimersAndFlush(300)
    const second = wsMock.instances[1]!
    second.emitOpen()
    expect(second.sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: 'client-intent-subscription', enabled: true },
    ])
    const payload = JSON.stringify({ type: 'settings-invalidated', scopes: ['theme'] })
    first.emitMessage(payload)
    second.emitMessage(payload)
    expect(listener).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledTimes(2)
    const lateOpen = vi.fn()
    const disposeLate = subscribeServerInvalidationIngress(() => {}, lateOpen)
    expect(lateOpen).toHaveBeenCalledOnce()
    disposeLate()
    disposeIntent()
    disposeInvalidation()
    await advanceTimersAndFlush(300)
    expect(wsMock.instances).toHaveLength(2)
  })

  test('uses cookie authentication for an ordinary browser connection', async () => {
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', { configurable: true, value: { initialServer: null } })
    const { subscribeServerInvalidationIngress } = await import('#/web/realtime/notification-ingress.ts')
    const dispose = subscribeServerInvalidationIngress(() => {})
    const url = new URL(wsMock.instances[0]!.url)
    expect(url.host).toBe(window.location.host)
    expect(url.searchParams.has('t')).toBe(false)
    dispose()
  })

  test('reuses a connecting socket when subscribers replace each other', async () => {
    const { subscribeServerInvalidationIngress, subscribeServerClientIntentIngress } =
      await import('#/web/realtime/notification-ingress.ts')
    const firstDispose = subscribeServerInvalidationIngress(() => {})
    firstDispose()
    const secondDispose = subscribeServerClientIntentIngress(() => {})
    expect(wsMock.instances).toHaveLength(1)
    wsMock.instances[0]!.emitOpen()
    expect(JSON.parse(wsMock.instances[0]!.sent[0]!)).toEqual({ type: 'client-intent-subscription', enabled: true })
    secondDispose()
    expect(wsMock.instances[0]!.readyState).toBe(wsMock.CLOSED)
  })

  test('drops malformed and unknown invalidation messages', async () => {
    const { subscribeServerInvalidationIngress } = await import('#/web/realtime/notification-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerInvalidationIngress(listener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage('not json')
    socket.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['unknown'] }))
    socket.emitMessage(JSON.stringify({ type: 'unknown-event' }))

    expect(listener).not.toHaveBeenCalled()
    dispose()
  })
})

describe('server client intent ingress', () => {
  let wsMock: WebSocketMockHandle

  beforeEach(() => {
    vi.resetModules()
    wsMock = installWebSocketMock({ autoOpen: false })
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'test-token' },
      },
    })
  })

  afterEach(async () => {
    const { resetServerNotificationIngressForTests } = await import('#/web/realtime/notification-ingress.ts')
    resetServerNotificationIngressForTests()
  })

  test('connects to the client-intent channel', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/realtime/notification-ingress.ts')
    const dispose = subscribeServerClientIntentIngress(() => {})

    expect(wsMock.instances[0]?.url).toContain('/ws/notifications')
    dispose()
  })

  test('dispatches a valid client-effect-intent envelope', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/realtime/notification-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerClientIntentIngress(listener)

    wsMock.instances[0]?.emitMessage(
      JSON.stringify({
        type: 'client-effect-intent',
        intent: { type: 'show-workspace-pane-tab-requested', tab: 'changes' },
      }),
    )

    expect(listener).toHaveBeenCalledWith({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })
    dispose()
  })

  test('drops malformed client-effect-intent envelopes', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/realtime/notification-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerClientIntentIngress(listener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage('not json')
    socket.emitMessage(JSON.stringify({ type: 'something-else', intent: {} }))
    socket.emitMessage(JSON.stringify({ type: 'client-effect-intent', intent: { type: 'banana' } }))

    expect(listener).not.toHaveBeenCalled()
    dispose()
  })

  test('rejects native-only lifecycle intents from the server ingress', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/realtime/notification-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerClientIntentIngress(listener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage(JSON.stringify({ type: 'client-effect-intent', intent: { type: 'app-quitting' } }))

    expect(listener).not.toHaveBeenCalled()
    dispose()
  })
})
