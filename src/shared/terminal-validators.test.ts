import { describe, expect, test } from 'vitest'
import {
  isValidTerminalClientId,
  isValidTerminalNotifyBellInput,
  isValidTerminalTestNotificationInput,
  isTerminalWsMessageWithinLimit,
  isValidTerminalSize,
  isValidTerminalRuntimeSessionId,
  normalizeTerminalClientMessage,
  normalizeTerminalCreateResult,
  normalizeTerminalSize,
  normalizeTerminalSocketServerMessage,
  terminalUtf8ByteLength,
  TERMINAL_WS_MESSAGE_LIMIT_BYTES,
} from '#/shared/terminal-validators.ts'

describe('shared terminal validators', () => {
  test('normalizes terminal sizes within supported bounds', () => {
    expect(normalizeTerminalSize(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(normalizeTerminalSize(80.9, 24.2)).toEqual({ cols: 80, rows: 24 })
    expect(normalizeTerminalSize(0, 24)).toBeNull()
    expect(normalizeTerminalSize(80, 301)).toBeNull()
    expect(isValidTerminalSize(120, 40)).toBe(true)
    expect(isValidTerminalSize('120', 40)).toBe(false)
  })

  test('validates attachment ids and bell payloads', () => {
    expect(isValidTerminalRuntimeSessionId('pty_1234567890abcdef')).toBe(true)
    expect(isValidTerminalRuntimeSessionId('short')).toBe(false)
    expect(isValidTerminalRuntimeSessionId('bad id')).toBe(false)

    expect(isValidTerminalClientId(undefined)).toBe(true)
    expect(isValidTerminalClientId('client_a')).toBe(true)
    expect(isValidTerminalClientId('bad id')).toBe(false)

    expect(
      isValidTerminalNotifyBellInput({
        title: 'Build finished',
        body: 'done',
        repoRoot: '/repo',
      }),
    ).toBe(true)
    expect(
      isValidTerminalNotifyBellInput({
        title: '',
        body: 'done',
        repoRoot: '/repo',
      }),
    ).toBe(false)

    expect(isValidTerminalTestNotificationInput({ title: 'Goblin', body: 'Notifications are working' })).toBe(true)
    expect(isValidTerminalTestNotificationInput({ title: '', body: 'Notifications are working' })).toBe(false)
  })

  test('measures terminal websocket messages in UTF-8 bytes', () => {
    expect('你'.length).toBe(1)
    expect(terminalUtf8ByteLength('你')).toBe(3)
    expect('😀'.length).toBe(2)
    expect(terminalUtf8ByteLength('😀')).toBe(4)
    expect(isTerminalWsMessageWithinLimit('a'.repeat(TERMINAL_WS_MESSAGE_LIMIT_BYTES))).toBe(true)
    expect(isTerminalWsMessageWithinLimit('你'.repeat(Math.floor(TERMINAL_WS_MESSAGE_LIMIT_BYTES / 2)))).toBe(false)
  })

  test('normalizes valid terminal client messages', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'req_1',
        action: 'attach',
        input: { terminalRuntimeSessionId: 'pty_1234567890abcdef', cols: 80, rows: 24, clientId: 'client_a' },
      }),
    ).toEqual({
      type: 'request',
      requestId: 'req_1',
      action: 'attach',
      input: { terminalRuntimeSessionId: 'pty_1234567890abcdef', cols: 80, rows: 24, clientId: 'client_a' },
    })

    expect(normalizeTerminalClientMessage({ type: 'ping', requestId: 'health_1' })).toEqual({
      type: 'ping',
      requestId: 'health_1',
    })

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'bad id',
        action: 'attach',
        input: { terminalRuntimeSessionId: 'pty_1234567890abcdef', cols: 80, rows: 24 },
      }),
    ).toBeNull()
  })

  test('rejects NUL bytes in terminal write data', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: 'write',
        input: {
          terminalRuntimeSessionId: 'pty_session_123456',
          data: 'echo\0bad',
        },
      }),
    ).toBeNull()
  })

  test('rejects empty terminal ids in workspace tab replacement requests', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: 'replace-tabs',
        input: {
          repoRoot: '/repo',
          repoInstanceId: 'repo-instance-test',
          branchName: 'main',
          worktreePath: '/repo',
          tabs: [{ type: 'terminal', terminalSessionId: '' }],
        },
      }),
    ).toBeNull()
  })

  test('accepts workspace tab operation requests and rejects invalid identities', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: 'update-tabs',
        input: {
          repoRoot: '/repo',
          repoInstanceId: 'repo-instance-test',
          branchName: 'main',
          worktreePath: '/repo',
          operation: { type: 'open-static', tabType: 'history' },
        },
      }),
    ).toMatchObject({ type: 'request', action: 'update-tabs' })

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_124',
        action: 'update-tabs',
        input: {
          repoRoot: '/repo',
          repoInstanceId: 'repo-instance-test',
          branchName: 'main',
          worktreePath: '/repo',
          operation: { type: 'reorder', tabIdentities: ['workspace-pane:status', 'bad\0identity'] },
        },
      }),
    ).toBeNull()
  })

  test('rejects prune requests without a repo instance id', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_125',
        action: 'prune',
        input: {
          repoRoot: '/repo',
        },
      }),
    ).toBeNull()

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_126',
        action: 'prune',
        input: {
          repoRoot: '/repo',
          repoInstanceId: 'repo-instance-test',
        },
      }),
    ).toMatchObject({ type: 'request', action: 'prune' })
  })

  test('rejects NUL bytes in startup shell commands', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: 'create',
        input: {
          repoRoot: '/repo',
          branch: 'main',
          worktreePath: '/repo',
          kind: 'additional',
          startupShellCommand: 'cat\0bad',
        },
      }),
    ).toBeNull()
  })

  test('normalizes terminal create results with required first-frame payloads', () => {
    expect(
      normalizeTerminalCreateResult({
        ok: true,
        action: 'created',
        terminalSessionId: 'session-1',
        tabs: [],
        sessions: [],
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        snapshot: 'first frame',
        snapshotSeq: 1,
        outputEra: 0,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    ).toMatchObject({
      ok: true,
      terminalSessionId: 'session-1',
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      snapshotSeq: 1,
    outputEra: 0,
    })

    expect(
      normalizeTerminalCreateResult({
        ok: true,
        action: 'created',
        terminalSessionId: 'session-1',
        tabs: [],
        sessions: [],
      }),
    ).toBeNull()
    expect(normalizeTerminalCreateResult({ ok: false, message: 'error.spawn-failed' })).toEqual({
      ok: false,
      message: 'error.spawn-failed',
    })
  })

  test('normalizes valid terminal socket server messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalSessionId: 'session-1',
          data: 'hi',
          seq: 1,
          outputEra: 0,
          processName: 'zsh',
        },
      }),
    ).toEqual({
      type: 'output',
      event: {
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalSessionId: 'session-1',
        data: 'hi',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      },
    })

    expect(normalizeTerminalSocketServerMessage({ type: 'pong', requestId: 'health_1' })).toEqual({
      type: 'pong',
      requestId: 'health_1',
    })

    expect(
      normalizeTerminalSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: false,
        action: 'attach',
      }),
    ).toBeNull()
  })

  test('normalizes targeted session-closed realtime messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalSessionId: 'session-1',
        repoRoot: '/repo',
        worktreePath: '/repo/worktree',
      }),
    ).toEqual({
      type: 'session-closed',
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalSessionId: 'session-1',
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
    })
  })

  test('normalizes workspace tabs changed realtime messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'workspace-tabs-changed',
        repoRoot: '/repo',
      }),
    ).toEqual({
      type: 'workspace-tabs-changed',
      repoRoot: '/repo',
    })
  })
})
