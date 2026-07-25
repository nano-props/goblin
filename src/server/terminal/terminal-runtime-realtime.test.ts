import { describe, expect, test, vi } from 'vitest'
import {
  createTerminalRealtimeHandlers,
  handleTerminalRealtimeRequestMessage,
  requiresRealtimeOrdering,
} from '#/server/terminal/terminal-runtime-realtime.ts'
import type { ServerTerminalActionHost } from '#/server/terminal/terminal-host.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'

function makeTerminalActionHost(overrides: Partial<ServerTerminalActionHost>): ServerTerminalActionHost {
  return {
    isClientOnline: () => true,
    attach: async () => ({ ok: false, message: 'not configured' }),
    restart: async () => ({ ok: false, message: 'not configured' }),
    write: async () => ({ status: 'rejected' }),
    resize: () => ({ ok: false, message: 'not configured' }),
    takeover: () => ({ ok: false, message: 'not configured' }),
    close: () => false,
    listSessions: () => [],
    recoverSessions: () => ({ revision: 0, sessions: [] }),
    prune: () => ({ pruned: 0, remaining: 0 }),
    ...overrides,
  }
}
import { normalizeAppRealtimeSocketServerMessage } from '#/shared/app-realtime-validators.ts'
import { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'

describe('terminal realtime handlers', () => {
  test('orders every externally supported authoritative terminal frame request, including takeover', () => {
    expect(requiresRealtimeOrdering('attach')).toBe(true)
    expect(requiresRealtimeOrdering('restart')).toBe(true)
    expect(requiresRealtimeOrdering('takeover')).toBe(true)
    expect(requiresRealtimeOrdering('resize')).toBe(false)
  })

  test('preserves every terminal write result through serialization and shared validation', async () => {
    for (const status of ['accepted', 'rejected', 'indeterminate'] as const) {
      const result: TerminalWriteResult = { status }
      const host = makeTerminalActionHost({ write: () => result })
      const handlers = createTerminalRealtimeHandlers(host)
      let serialized = ''

      await handleTerminalRealtimeRequestMessage(
        handlers,
        'client-test',
        'user-test',
        { send: (data) => (serialized = data), close: () => {} },
        {
          type: 'request',
          requestId: `request-${status}`,
          action: 'write',
          input: {
            terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
            terminalRuntimeGeneration: 1,
            data: 'input',
          },
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
    const sessionsChanged = JSON.stringify({
      type: 'sessions-changed',
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 5,
    })
    const output = JSON.stringify({
      type: 'output',
      event: {
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'prompt',
        seq: 1,
        processName: 'zsh',
      },
    })
    const host = makeTerminalActionHost({
      attach: async () => {
        buffered.send(sessionsChanged)
        buffered.send(output)
        return {
          ok: true as const,
          frame: 'stream' as const,
          terminalProjectionEffect: { kind: 'delta' as const, revision: 5 },
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          controller: { clientId: 'client-test', status: 'connected' as const },
          canonicalSize: { cols: 100, rows: 30 },
        }
      },
    })

    buffered.enqueueTransition(() =>
      handleTerminalRealtimeRequestMessage(createTerminalRealtimeHandlers(host), 'client-test', 'user-test', socket, {
        type: 'request',
        requestId: 'request-fresh-attach',
        action: 'attach',
        input: {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 0,
          cols: 100,
          rows: 30,
        },
      }),
    )
    await vi.waitFor(() => expect(sent).toHaveLength(3))

    expect(JSON.parse(sent[0] ?? '')).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: {
        ok: true,
        frame: 'stream',
        terminalProjectionEffect: { kind: 'delta', revision: 5 },
      },
    })
    expect(sent[1]).toBe(sessionsChanged)
    expect(sent[2]).toBe(output)
  })

  test('drops buffered output represented by an existing-session snapshot', async () => {
    const sent: string[] = []
    const socket = { send: vi.fn((payload: string) => sent.push(payload)), close: vi.fn() }
    const buffered = new BufferedAppRealtimeSocket(socket)
    const host = makeTerminalActionHost({
      attach: async () => {
        buffered.send(
          JSON.stringify({
            type: 'output',
            event: {
              terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
              terminalRuntimeGeneration: 1,
              terminalSessionId: 'term-111111111111111111111',
              data: 'included',
              seq: 1,
              processName: 'zsh',
            },
          }),
        )
        return {
          ok: true as const,
          frame: 'snapshot' as const,
          terminalProjectionEffect: { kind: 'none' as const },
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          snapshot: 'included',
          snapshotSeq: 1,
          controller: { clientId: 'client-test', status: 'connected' as const },
          canonicalSize: { cols: 100, rows: 30 },
        }
      },
    })

    buffered.enqueueTransition(() =>
      handleTerminalRealtimeRequestMessage(createTerminalRealtimeHandlers(host), 'client-test', 'user-test', socket, {
        type: 'request',
        requestId: 'request-snapshot-attach',
        action: 'attach',
        input: {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      }),
    )
    await vi.waitFor(() => expect(sent).toHaveLength(1))

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0] ?? '')).toMatchObject({ payload: { ok: true, frame: 'snapshot' } })
  })

  test('orders a restart delta response before its buffered sessions event', async () => {
    const sent: string[] = []
    const socket = { send: vi.fn((payload: string) => sent.push(payload)), close: vi.fn() }
    const buffered = new BufferedAppRealtimeSocket(socket)
    const sessionsChanged = JSON.stringify({
      type: 'sessions-changed',
      workspaceId: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 6,
    })
    const host = makeTerminalActionHost({
      restart: async () => {
        buffered.send(sessionsChanged)
        return {
          ok: true as const,
          frame: 'stream' as const,
          terminalProjectionEffect: { kind: 'delta' as const, revision: 6 },
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 2,
          identityRevision: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          controller: { clientId: 'client-test', status: 'connected' as const },
          canonicalSize: { cols: 100, rows: 30 },
        }
      },
    })

    buffered.enqueueTransition(() =>
      handleTerminalRealtimeRequestMessage(createTerminalRealtimeHandlers(host), 'client-test', 'user-test', socket, {
        type: 'request',
        requestId: 'request-restart',
        action: 'restart',
        input: {
          terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
          terminalRuntimeGeneration: 1,
          cols: 100,
          rows: 30,
        },
      }),
    )
    await vi.waitFor(() => expect(sent).toHaveLength(2))

    expect(JSON.parse(sent[0] ?? '')).toMatchObject({
      type: 'response',
      action: 'restart',
      payload: { frame: 'stream', terminalProjectionEffect: { kind: 'delta', revision: 6 } },
    })
    expect(sent[1]).toBe(sessionsChanged)
  })
})
