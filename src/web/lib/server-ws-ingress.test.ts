// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION, type ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

describe('server websocket ingress', () => {
  let wsMock: WebSocketMockHandle

  beforeEach(() => {
    vi.resetModules()
    wsMock = installWebSocketMock({ autoOpen: false })
    installBootstrap({ url: 'http://127.0.0.1:32100/', accessToken: 'test-token' })
  })

  test('builds the configured WebSocket URL with embedded-server authentication', async () => {
    const ingress = await createIngress('/ws/example')

    const dispose = ingress.subscribe(() => {})

    expect(wsMock.instances).toHaveLength(1)
    expect(wsMock.instances[0]?.url).toBe('ws://127.0.0.1:32100/ws/example?t=test-token')
    dispose()
    ingress.resetForTests()
  })

  test('uses the browser origin without a URL token when there is no server handoff', async () => {
    installBootstrap(null)
    const ingress = await createIngress('/ws/example')

    const dispose = ingress.subscribe(() => {})

    expect(wsMock.instances[0]?.url).toBe(`${webSocketOrigin()}/ws/example`)
    dispose()
    ingress.resetForTests()
  })

  test('parses each frame once and fans valid messages out to current subscribers', async () => {
    const parseMessage = vi.fn((data: unknown) => (typeof data === 'string' ? data.toUpperCase() : null))
    const ingress = await createIngress('/ws/example', parseMessage)
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const disposeFirst = ingress.subscribe(firstListener)
    const disposeSecond = ingress.subscribe(secondListener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage('hello')
    socket.emitMessage({ malformed: true })
    disposeFirst()
    socket.emitMessage('after')

    expect(parseMessage).toHaveBeenCalledTimes(3)
    expect(firstListener).toHaveBeenCalledOnce()
    expect(firstListener).toHaveBeenCalledWith('HELLO')
    expect(secondListener.mock.calls.map(([message]) => message)).toEqual(['HELLO', 'AFTER'])
    disposeSecond()
    ingress.resetForTests()
  })

  test('reuses a connecting socket when an idle close is cancelled by a new subscriber', async () => {
    const ingress = await createIngress('/ws/example')

    const disposeFirst = ingress.subscribe(() => {})
    disposeFirst()
    const disposeSecond = ingress.subscribe(() => {})

    expect(wsMock.instances).toHaveLength(1)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')
    socket.emitOpen()
    disposeSecond()
    expect(socket.readyState).toBe(wsMock.CLOSED)
    ingress.resetForTests()
  })

  test('reconnects after an unexpected close and ignores events from the retired socket', async () => {
    useFakeTimers()
    const listener = vi.fn()
    const ingress = await createIngress('/ws/example')
    const dispose = ingress.subscribe(listener)
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing initial socket')

    firstSocket.close()
    await advanceTimersAndFlush(299)
    expect(wsMock.instances).toHaveLength(1)
    await advanceTimersAndFlush(1)

    const secondSocket = wsMock.instances[1]
    if (!secondSocket) throw new Error('missing reconnected socket')
    firstSocket.emitMessage('stale')
    secondSocket.emitMessage('fresh')

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith('fresh')
    dispose()
    ingress.resetForTests()
  })

  test('notifies subscribers when the connection opens and after reconnect', async () => {
    useFakeTimers()
    const onOpen = vi.fn()
    const ingress = await createIngress('/ws/example')
    const dispose = ingress.subscribe(() => {}, onOpen)
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing initial socket')

    firstSocket.emitOpen()
    expect(onOpen).toHaveBeenCalledOnce()

    firstSocket.close()
    await advanceTimersAndFlush(300)
    const secondSocket = wsMock.instances[1]
    if (!secondSocket) throw new Error('missing reconnected socket')
    secondSocket.emitOpen()

    expect(onOpen).toHaveBeenCalledTimes(2)
    const lateOnOpen = vi.fn()
    const disposeLate = ingress.subscribe(() => {}, lateOnOpen)
    expect(lateOnOpen).toHaveBeenCalledOnce()

    disposeLate()
    dispose()
    ingress.resetForTests()
  })

  test('closes the active socket and suppresses reconnect when app shutdown starts', async () => {
    useFakeTimers()
    const ingress = await createIngress('/ws/example')
    const dispose = ingress.subscribe(() => {})
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')
    const { markAppQuitting } = await import('#/web/app-lifecycle.ts')

    await markAppQuitting()
    await advanceTimersAndFlush(300)

    expect(socket.readyState).toBe(wsMock.CLOSED)
    expect(wsMock.instances).toHaveLength(1)
    dispose()
    ingress.resetForTests()
  })
})

async function createIngress(
  path: string,
  parseMessage: (data: unknown) => string | null = (data) => (typeof data === 'string' ? data : null),
) {
  const { createServerWebSocketIngress } = await import('#/web/lib/server-ws-ingress.ts')
  return createServerWebSocketIngress({ path, parseMessage })
}

function installBootstrap(initialServer: ClientBootstrapSnapshot['initialServer']): void {
  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer,
    } satisfies ClientBootstrapSnapshot,
  })
}

function webSocketOrigin(): string {
  const url = new URL(window.location.origin)
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.origin
}
