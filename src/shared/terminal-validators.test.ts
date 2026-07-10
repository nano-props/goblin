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
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import {
  normalizeAppRealtimeClientMessage,
  normalizeAppRealtimeSocketServerMessage,
} from '#/shared/app-realtime-validators.ts'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'

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
      normalizeAppRealtimeClientMessage({
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

    expect(normalizeAppRealtimeClientMessage({ type: 'ping', requestId: 'health_1' })).toEqual({
      type: 'ping',
      requestId: 'health_1',
    })

    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'bad id',
        action: 'attach',
        input: { terminalRuntimeSessionId: 'pty_1234567890abcdef', cols: 80, rows: 24 },
      }),
    ).toBeNull()
  })

  test('rejects NUL bytes in terminal write data', () => {
    expect(
      normalizeAppRealtimeClientMessage({
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
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'request_runtime_session_id',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        input: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: '/repo',
          tabs: [{ type: 'terminal', runtimeSessionId: 'term-111111111111111111111' }],
        },
      }),
    ).toMatchObject({ type: 'request', action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace })

    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        input: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: '/repo',
          tabs: [{ type: 'terminal', terminalSessionId: '' }],
        },
      }),
    ).toBeNull()

    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        input: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: '/repo',
          tabs: [{ type: 'terminal', runtimeSessionId: '' }],
        },
      }),
    ).toBeNull()
  })

  test('accepts workspace tab operation requests and rejects invalid identities', () => {
    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'request_123',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        input: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: '/repo',
          operation: { type: 'open-static', tabType: 'history' },
        },
      }),
    ).toMatchObject({ type: 'request', action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update })

    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'request_legacy_tabs',
        action: 'update-tabs',
        input: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: '/repo',
          operation: { type: 'open-static', tabType: 'history' },
        },
      }),
    ).toBeNull()

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_124',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        input: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branchName: 'main',
          worktreePath: '/repo',
          operation: { type: 'reorder', tabIdentities: ['workspace-pane:status', 'bad\0identity'] },
        },
      }),
    ).toBeNull()
  })

  test('normalizes runtime-open application requests with provider validation', () => {
    const message = {
      type: 'request',
      requestId: 'request_runtime_open',
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      input: {
        runtimeType: 'terminal',
        request: {
          repoRoot: '/repo',
          repoRuntimeId: 'repo-runtime-test',
          branch: 'main',
          worktreePath: '/repo/worktree',
          kind: 'primary',
          cols: 100,
          rows: 30,
          clientId: 'client_a',
        },
        insertAfterIdentity: 'workspace-pane:status',
      },
    }

    expect(normalizeAppRealtimeClientMessage(message)).toEqual(message)
    expect(
      normalizeAppRealtimeClientMessage({
        ...message,
        input: { ...message.input, insertAfterIdentity: 'bad\0identity' },
      }),
    ).toBeNull()
    expect(
      normalizeAppRealtimeClientMessage({
        ...message,
        input: { ...message.input, request: { ...message.input.request, cols: 0 } },
      }),
    ).toBeNull()
  })

  test('normalizes runtime close application requests and rejects invalid session ids', () => {
    const target = {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branchName: 'main',
      worktreePath: '/repo/worktree',
    }
    const closeMessage = {
      type: 'request',
      requestId: 'request_runtime_close',
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
      input: {
        runtimeType: 'terminal',
        sessionId: 'term-111111111111111111111',
        target,
      },
    }
    expect(normalizeAppRealtimeClientMessage(closeMessage)).toEqual(closeMessage)
    expect(
      normalizeAppRealtimeClientMessage({
        ...closeMessage,
        input: { ...closeMessage.input, sessionId: '' },
      }),
    ).toBeNull()
  })

  test('rejects prune requests without a repo runtime id', () => {
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
          repoRuntimeId: 'repo-runtime-test',
        },
      }),
    ).toMatchObject({ type: 'request', action: 'prune' })
  })

  test('rejects unsupported terminal create realtime requests', () => {
    const unsupportedCreateRequest = {
      type: 'request',
      requestId: 'request_123',
      action: 'create',
      input: {
        repoRoot: '/repo',
        branch: 'main',
        worktreePath: '/repo',
        kind: 'additional',
        repoRuntimeId: 'repo-runtime-test',
      },
    }
    expect(normalizeTerminalClientMessage(unsupportedCreateRequest)).toBeNull()
    expect(normalizeAppRealtimeClientMessage(unsupportedCreateRequest)).toBeNull()
  })

  test('normalizes terminal create results with required first-frame payloads', () => {
    const normalizedCreateResult = normalizeTerminalCreateResult({
      ok: true,
      action: 'created',
      terminalSessionId: 'term-111111111111111111111',
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
    })
    expect(normalizedCreateResult).toMatchObject({
      ok: true,
      terminalSessionId: 'term-111111111111111111111',
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      snapshotSeq: 1,
      outputEra: 0,
    })
    expect(normalizedCreateResult).not.toHaveProperty('tabs')

    expect(
      normalizeTerminalCreateResult({
        ok: true,
        action: 'created',
        terminalSessionId: 'term-111111111111111111111',
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
      normalizeAppRealtimeSocketServerMessage({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalSessionId: 'term-111111111111111111111',
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
        terminalSessionId: 'term-111111111111111111111',
        data: 'hi',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      },
    })

    expect(normalizeAppRealtimeSocketServerMessage({ type: 'pong', requestId: 'health_1' })).toEqual({
      type: 'pong',
      requestId: 'health_1',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: false,
        action: 'attach',
      }),
    ).toBeNull()

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_workspace_tabs',
        ok: true,
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        payload: { revision: 3, entries: [] },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_workspace_tabs',
      ok: true,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      payload: { revision: 3, entries: [] },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_workspace_tabs_invalid_revision',
        ok: true,
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        payload: { revision: -1, entries: [] },
      }),
    ).toMatchObject({
      ok: false,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
      error: 'Invalid realtime socket response payload',
    })
  })

  test('normalizes runtime-open application responses as one provider-and-tabs outcome', () => {
    const payload = {
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        ok: true,
        action: 'created',
        terminalSessionId: 'term-111111111111111111111',
        sessions: [],
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        snapshot: 'prompt',
        snapshotSeq: 1,
        outputEra: 0,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 120,
        canonicalRows: 40,
      },
      workspacePaneTabs: {
        revision: 4,
        entries: [
          {
            repoRoot: '/repo',
            branchName: 'main',
            worktreePath: '/repo/worktree',
            tabs: [{ type: 'terminal', runtimeSessionId: 'term-111111111111111111111' }],
          },
        ],
      },
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload,
      }),
    ).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      payload,
    })
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_invalid',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, runtime: { ...payload.runtime, outputEra: undefined } },
      }),
    ).toMatchObject({
      ok: false,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      error: 'Invalid realtime socket response payload',
    })
  })

  test('normalizes runtime close application responses with canonical snapshots', () => {
    const workspacePaneTabs = {
      revision: 5,
      entries: [
        {
          repoRoot: '/repo',
          branchName: 'main',
          worktreePath: '/repo/worktree',
          tabs: [{ type: 'status', tabId: 'workspace-pane:status' }],
        },
      ],
    }

    for (const [index, action] of [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close].entries()) {
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `request_runtime_close_${index}`,
          ok: true,
          action,
          payload: { ok: true, runtimeType: 'terminal', runtime: { sessions: [] }, workspacePaneTabs },
        }),
      ).toMatchObject({
        type: 'response',
        ok: true,
        action,
        payload: { ok: true, runtimeType: 'terminal', runtime: { sessions: [] }, workspacePaneTabs },
      })
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `request_runtime_close_invalid_${index}`,
          ok: true,
          action,
          payload: {
            ok: true,
            runtimeType: 'terminal',
            runtime: { sessions: [] },
            workspacePaneTabs: { revision: 5, entries: null },
          },
        }),
      ).toMatchObject({
        ok: false,
        action,
        error: 'Invalid realtime socket response payload',
      })
    }
  })

  test('validates terminal socket success response payloads by action', () => {
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          snapshot: 'prompt',
          snapshotSeq: 1,
          outputEra: 0,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalCols: 120,
          canonicalRows: 40,
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: { ok: true, outputEra: 0 },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          snapshot: 'prompt',
          snapshotSeq: 1,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalCols: 120,
          canonicalRows: 40,
        },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_1',
      ok: false,
      action: 'attach',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'create',
        payload: {},
      }),
    ).toBeNull()
  })

  test('normalizes targeted session-closed realtime messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: '/repo',
        worktreePath: '/repo/worktree',
      }),
    ).toEqual({
      type: 'session-closed',
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: '/repo',
      worktreePath: '/repo/worktree',
    })
  })

  test('normalizes workspace tabs changed realtime messages', () => {
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
        repoRoot: '/repo',
      }),
    ).toEqual({
      type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
      repoRoot: '/repo',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'workspace-tabs-changed',
        repoRoot: '/repo',
      }),
    ).toBeNull()
  })
})
