// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { createClientAppRealtime } from '#/web/app-realtime-client.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

let wsMock: WebSocketMockHandle

describe('client app realtime', () => {
  beforeEach(() => {
    wsMock = installWebSocketMock({ autoOpen: false })
    useFakeTimers()
  })

  test('notifies recovery subscribers only after a reconnect open', async () => {
    const client = createClientAppRealtime({
      getServerConfig: () => ({
        url: 'http://127.0.0.1:32100/',
        accessToken: 'secret',
        clientId: 'client_realtime',
      }),
    })
    const onRecovered = vi.fn()

    const dispose = client.onRecovered(onRecovered)
    wsMock.instances[0]?.emitOpen()

    expect(onRecovered).not.toHaveBeenCalled()

    wsMock.instances[0]?.close()
    await vi.advanceTimersByTimeAsync(300)
    wsMock.instances[1]?.emitOpen()

    expect(onRecovered).toHaveBeenCalledWith('client_realtime')
    dispose()
  })

  test('surfaces server configuration failures when opening realtime', () => {
    const failure = new Error('invalid server configuration')
    const client = createClientAppRealtime({
      getServerConfig: () => {
        throw failure
      },
    })

    expect(() => client.onMessage(() => {})).toThrow(failure)
    expect(wsMock.instances).toHaveLength(0)
  })
})
