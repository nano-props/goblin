import { describe, expect, test } from 'vitest'
import { APP_REALTIME_WS_MESSAGE_LIMIT_BYTES } from '#/shared/app-realtime-validators.ts'
import type { AppRealtimeClientMessage } from '#/shared/app-realtime-socket.ts'
import { encodeAppRealtimeClientMessage } from '#/web/app-realtime-socket-utils.ts'

describe('app realtime socket encoding', () => {
  test('rejects a request whose complete encoded frame exceeds the transport limit', () => {
    const message = {
      type: 'request',
      requestId: 'req_1234567890abcdef',
      action: 'write',
      input: {
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
        data: 'a'.repeat(APP_REALTIME_WS_MESSAGE_LIMIT_BYTES),
      },
    } satisfies AppRealtimeClientMessage

    expect(() => encodeAppRealtimeClientMessage(message)).toThrow('App realtime message exceeds transport limit')
  })
})
