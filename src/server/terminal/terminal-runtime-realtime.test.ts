import { describe, expect, test } from 'vitest'
import {
  createTerminalRealtimeHandlers,
  handleTerminalRealtimeRequestMessage,
  shouldPauseRealtimeRequest,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import type { ServerTerminalActionHost } from '#/server/terminal/terminal-host.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'
import { normalizeAppRealtimeSocketServerMessage } from '#/shared/app-realtime-validators.ts'

describe('terminal realtime handlers', () => {
  test('pauses every externally supported authoritative terminal frame request, including takeover', () => {
    expect(shouldPauseRealtimeRequest('attach')).toBe(true)
    expect(shouldPauseRealtimeRequest('restart')).toBe(true)
    expect(shouldPauseRealtimeRequest('takeover')).toBe(true)
    expect(shouldPauseRealtimeRequest('resize')).toBe(false)
  })

  test('preserves every terminal write result through serialization and shared validation', async () => {
    for (const status of ['accepted', 'rejected', 'indeterminate'] as const) {
      const result: TerminalWriteResult = { status }
      const host = { write: () => result } as unknown as ServerTerminalActionHost
      const handlers = createTerminalRealtimeHandlers(host)
      let serialized = ''

      await handleTerminalRealtimeRequestMessage(
        handlers,
        'client-test',
        'user-test',
        { send: (data) => (serialized = data), close: () => {} },
        undefined,
        {
          type: 'request',
          requestId: `request-${status}`,
          action: 'write',
          input: { terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa', data: 'input' },
        },
      )

      expect(normalizeAppRealtimeSocketServerMessage(JSON.parse(serialized))).toEqual({
        type: 'response',
        requestId: `request-${status}`,
        ok: true,
        action: 'write',
        payload: { status },
      })
    }
  })
})
