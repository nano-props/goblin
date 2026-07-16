import { describe, expect, test, vi } from 'vitest'
import {
  createTerminalRealtimeHandlers,
  handleTerminalRealtimeRequestMessage,
  shouldPauseRealtimeRequest,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import type { ServerTerminalActionHost } from '#/server/terminal/terminal-host.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'
import { normalizeAppRealtimeSocketServerMessage } from '#/shared/app-realtime-validators.ts'
import { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'

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

  test('orders a fresh attach response before buffered output without dropping sequence 1', async () => {
    const sent: string[] = []
    const socket = { send: vi.fn((payload: string) => sent.push(payload)), close: vi.fn() }
    const buffered = new BufferedAppRealtimeSocket(socket)
    buffered.pause()
    const output = JSON.stringify({
      type: 'output',
      event: {
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'prompt',
        outputEra: 0,
        seq: 1,
        processName: 'zsh',
      },
    })
    const host = {
      attach: async () => {
        buffered.send(output)
        return {
          ok: true as const,
          frame: 'stream' as const,
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'opening' as const,
          message: null,
          controller: { clientId: 'client-test', status: 'connected' as const },
          canonicalCols: 100,
          canonicalRows: 30,
        }
      },
    } as unknown as ServerTerminalActionHost

    await handleTerminalRealtimeRequestMessage(
      createTerminalRealtimeHandlers(host),
      'client-test',
      'user-test',
      socket,
      buffered,
      {
        type: 'request',
        requestId: 'request-fresh-attach',
        action: 'attach',
        input: { terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa', cols: 100, rows: 30 },
      },
    )

    expect(JSON.parse(sent[0] ?? '')).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: { ok: true, frame: 'stream' },
    })
    expect(sent[1]).toBe(output)
  })

  test('drops buffered output represented by an existing-session snapshot', async () => {
    const sent: string[] = []
    const socket = { send: vi.fn((payload: string) => sent.push(payload)), close: vi.fn() }
    const buffered = new BufferedAppRealtimeSocket(socket)
    buffered.pause()
    const host = {
      attach: async () => {
        buffered.send(
          JSON.stringify({
            type: 'output',
            event: {
              terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
              terminalRuntimeGeneration: 1,
              terminalSessionId: 'term-111111111111111111111',
              data: 'included',
              outputEra: 0,
              seq: 1,
              processName: 'zsh',
            },
          }),
        )
        return {
          ok: true as const,
          frame: 'snapshot' as const,
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          snapshot: 'included',
          snapshotSeq: 1,
          outputEra: 0,
          controller: { clientId: 'client-test', status: 'connected' as const },
          canonicalCols: 100,
          canonicalRows: 30,
        }
      },
    } as unknown as ServerTerminalActionHost

    await handleTerminalRealtimeRequestMessage(
      createTerminalRealtimeHandlers(host),
      'client-test',
      'user-test',
      socket,
      buffered,
      {
        type: 'request',
        requestId: 'request-snapshot-attach',
        action: 'attach',
        input: { terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa', cols: 100, rows: 30 },
      },
    )

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0] ?? '')).toMatchObject({ payload: { ok: true, frame: 'snapshot' } })
  })
})
