// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createClientAppRealtime } from '#/web/app-realtime-client.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

let wsMock: WebSocketMockHandle

describe('client app realtime', () => {
  beforeEach(() => {
    wsMock = installWebSocketMock({ autoOpen: false })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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
})
