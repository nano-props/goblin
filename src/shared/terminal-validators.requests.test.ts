import { describe, expect, test } from 'vitest'
import {
  constrainTerminalSize,
  isTerminalWsMessageWithinLimit,
  isValidTerminalSize,
  isValidTerminalWriteData,
  MAX_TERMINAL_WRITE_CHARS,
  normalizeTerminalSize,
  terminalUtf8ByteLength,
  TERMINAL_WS_MESSAGE_LIMIT_BYTES,
} from '#/shared/terminal-protocol-constraints.ts'
import {
  isValidTerminalClientId,
  isValidTerminalNotifyBellInput,
  isValidTerminalTestNotificationInput,
  isValidTerminalRuntimeSessionId,
  normalizeTerminalClientMessage,
  normalizeTerminalRealtimeMessage,
  normalizeTerminalSocketServerMessage,
} from '#/shared/terminal-validators.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import { normalizeAppRealtimeClientMessage } from '#/shared/app-realtime-validators.ts'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'

describe('shared terminal validators requests', () => {
  test('constrains trusted terminal measurements to protocol bounds', () => {
    expect(constrainTerminalSize(700, 400)).toEqual({ cols: 500, rows: 300 })
    expect(constrainTerminalSize(0, -10)).toEqual({ cols: 1, rows: 1 })
    expect(constrainTerminalSize(80.9, 24.2)).toEqual({ cols: 80, rows: 24 })
    expect(constrainTerminalSize(Number.POSITIVE_INFINITY, 24)).toBeNull()
    expect(constrainTerminalSize(80, Number.NaN)).toBeNull()
  })

  test('normalizes terminal sizes within supported bounds', () => {
    expect(normalizeTerminalSize(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(normalizeTerminalSize(80.9, 24.2)).toEqual({ cols: 80, rows: 24 })
    expect(normalizeTerminalSize(0, 24)).toBeNull()
    expect(normalizeTerminalSize(80, 301)).toBeNull()
    expect(isValidTerminalSize(120, 40)).toBe(true)
    expect(isValidTerminalSize('120', 40)).toBe(false)
  })

  test('validates terminal write data at the shared protocol boundary', () => {
    expect(isValidTerminalWriteData('echo ok')).toBe(true)
    expect(isValidTerminalWriteData('echo\0bad')).toBe(false)
    expect(isValidTerminalWriteData('x'.repeat(MAX_TERMINAL_WRITE_CHARS))).toBe(true)
    expect(isValidTerminalWriteData('x'.repeat(MAX_TERMINAL_WRITE_CHARS + 1))).toBe(false)
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
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).toBe(true)
    expect(
      isValidTerminalNotifyBellInput({
        title: 'Build finished',
        body: 'done',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
          index: 1,
        },
      }),
    ).toBe(false)
    expect(
      isValidTerminalNotifyBellInput({
        title: '',
        body: 'done',
        workspaceId: 'goblin+file:///repo',
      }),
    ).toBe(false)
    expect(
      isValidTerminalNotifyBellInput({
        title: 'Build finished',
        body: 'done',
        workspaceId: '/repo',
      }),
    ).toBe(false)
    expect(
      isValidTerminalNotifyBellInput({
        title: 'Build finished',
        body: 'done',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///C:/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).toBe(true)
    expect(
      isValidTerminalNotifyBellInput({
        title: 'Build finished',
        body: 'done',
        repoRoot: 'goblin+file:///repo',
      }),
    ).toBe(false)
    expect(
      isValidTerminalNotifyBellInput({
        title: 'Build finished',
        body: 'done',
        workspaceId: 'goblin+file:///repo',
        repoRoot: 'goblin+file:///repo',
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
        input: {
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 0,
          cols: 80,
          rows: 24,
        },
      }),
    ).toEqual({
      type: 'request',
      requestId: 'req_1',
      action: 'attach',
      input: {
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 0,
        cols: 80,
        rows: 24,
      },
    })

    expect(normalizeAppRealtimeClientMessage({ type: 'ping', requestId: 'health_1' })).toEqual({
      type: 'ping',
      requestId: 'health_1',
    })
    expect(normalizeAppRealtimeClientMessage({ type: 'ping', requestId: 'health_1', clientId: 'forged' })).toBeNull()
    expect(normalizeAppRealtimeClientMessage({ type: 'heartbeat' })).toBeNull()

    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'bad id',
        action: 'attach',
        input: {
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 0,
          cols: 80,
          rows: 24,
        },
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
          terminalRuntimeGeneration: 1,
          data: 'echo\0bad',
        },
      }),
    ).toBeNull()
  })

  test('normalizes structured terminal write results and rejects legacy booleans', () => {
    const response = {
      type: 'response' as const,
      requestId: 'request_write_123',
      ok: true as const,
      action: 'write' as const,
    }

    expect(normalizeTerminalSocketServerMessage({ ...response, payload: { status: 'accepted' } })).toEqual({
      ...response,
      payload: { status: 'accepted' },
    })
    expect(normalizeTerminalSocketServerMessage({ ...response, payload: true })).toMatchObject({
      type: 'response',
      ok: false,
      action: 'write',
    })
  })

  test('rejects empty terminal ids in workspace tab replacement requests', () => {
    expect(
      normalizeAppRealtimeClientMessage({
        type: 'request',
        requestId: 'request_runtime_session_id',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        input: {
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          target: {
            kind: 'git-worktree',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'repo-runtime-test',
            root: 'goblin+file:///repo',
          },
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
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          target: {
            kind: 'git-worktree',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'repo-runtime-test',
            root: 'goblin+file:///repo',
          },
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
          target: {
            kind: 'git-worktree',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'repo-runtime-test',
            root: 'goblin+file:///repo/worktree',
          },
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
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          target: {
            kind: 'git-worktree',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'repo-runtime-test',
            root: 'goblin+file:///repo',
          },
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
          target: {
            kind: 'git-worktree',
            workspaceId: 'goblin+file:///repo',
            workspaceRuntimeId: 'repo-runtime-test',
            root: 'goblin+file:///repo/worktree',
          },
          kind: 'primary',
        },
        insertAfterIdentity: 'workspace-pane:status',
      },
    }

    expect(normalizeAppRealtimeClientMessage(message)).toEqual(message)
    expect(
      normalizeAppRealtimeClientMessage({
        ...message,
        input: {
          ...message.input,
          request: { ...message.input.request, clientId: 'client_spoofed' },
        },
      }),
    ).toBeNull()
    expect(
      normalizeAppRealtimeClientMessage({
        ...message,
        input: { ...message.input, insertAfterIdentity: 'bad\0identity' },
      }),
    ).toBeNull()
    expect(
      normalizeAppRealtimeClientMessage({
        ...message,
        input: { ...message.input, request: { ...message.input.request, branch: 'main' } },
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
      target: {
        kind: 'git-worktree',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        root: 'goblin+file:///repo/worktree',
      },
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
    expect(
      normalizeAppRealtimeClientMessage({
        ...closeMessage,
        input: { ...closeMessage.input, target: { ...target, nativeWorktreePath: '/repo/worktree' } },
      }),
    ).toBeNull()
    expect(
      normalizeAppRealtimeClientMessage({
        ...closeMessage,
        input: {
          ...closeMessage.input,
          target: {
            target: {
              kind: 'git-branch',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
              branch: 'main',
            },
          },
        },
      }),
    ).toBeNull()
  })

  test('rejects client identity supplied inside terminal action payloads', () => {
    const terminalRuntimeSessionId = 'pty_request_123456789'
    const requests = [
      {
        action: 'attach',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 100, rows: 30 },
      },
      {
        action: 'restart',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 100, rows: 30 },
      },
      { action: 'write', input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, data: 'echo test' } },
      {
        action: 'resize',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 100, rows: 30 },
      },
      {
        action: 'takeover',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 100, rows: 30 },
      },
    ] as const

    for (const [index, request] of requests.entries()) {
      expect(
        normalizeTerminalClientMessage({
          type: 'request',
          requestId: `request_spoofed_${index}`,
          action: request.action,
          input: { ...request.input, clientId: 'client_spoofed' },
        }),
      ).toBeNull()
    }
  })

  test('requires a bound safe-integer generation on PTY mutation requests', () => {
    const terminalRuntimeSessionId = 'pty_request_123456789'
    const requests = [
      {
        type: 'request',
        requestId: 'request_write_generation',
        action: 'write',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, data: 'echo test' },
      },
      {
        type: 'request',
        requestId: 'request_resize_generation',
        action: 'resize',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 100, rows: 30 },
      },
      {
        type: 'request',
        requestId: 'request_takeover_generation',
        action: 'takeover',
        input: { terminalRuntimeSessionId, terminalRuntimeGeneration: 1, cols: 100, rows: 30 },
      },
    ] as const

    for (const request of requests) {
      expect(normalizeTerminalClientMessage(request)).toMatchObject({ action: request.action })
      const { terminalRuntimeGeneration: _, ...inputWithoutGeneration } = request.input
      expect(normalizeTerminalClientMessage({ ...request, input: inputWithoutGeneration })).toBeNull()
      for (const terminalRuntimeGeneration of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(
          normalizeTerminalClientMessage({
            ...request,
            input: { ...inputWithoutGeneration, terminalRuntimeGeneration },
          }),
        ).toBeNull()
      }
    }
  })

  test('rejects client identity and unknown fields on terminal request envelopes', () => {
    const request = {
      type: 'request',
      requestId: 'request_strict_envelope',
      action: 'write',
      input: {
        terminalRuntimeSessionId: 'pty_request_123456789',
        terminalRuntimeGeneration: 1,
        data: 'echo test',
      },
    } as const

    expect(normalizeTerminalClientMessage(request)).toEqual(request)
    expect(normalizeTerminalClientMessage({ ...request, clientId: 'client_spoofed' })).toBeNull()
    expect(normalizeTerminalClientMessage({ ...request, legacyField: true })).toBeNull()
  })

  test('rejects legacy and dual workspace identity on scoped terminal requests', () => {
    const message = {
      type: 'request',
      requestId: 'request_recover_sessions',
      action: 'recover-sessions',
      input: {
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
      },
    }
    expect(normalizeTerminalClientMessage(message)).toEqual(message)
    expect(
      normalizeTerminalClientMessage({
        ...message,
        input: { ...message.input, repoRoot: message.input.workspaceId },
      }),
    ).toBeNull()
    const { workspaceId, ...legacyInput } = message.input
    expect(normalizeTerminalClientMessage({ ...message, input: { ...legacyInput, repoRoot: workspaceId } })).toBeNull()
  })

  test('rejects legacy and dual workspace identity on terminal realtime events', () => {
    const scopedEvents = [
      {
        type: 'bell',
        event: {
          terminalRuntimeSessionId: 'pty_bell_123456789',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-bell-1111111111111111',
          workspaceId: 'goblin+file:///repo',
          processName: 'shell',
          canonicalTitle: null,
        },
      },
      {
        type: 'title',
        event: {
          terminalRuntimeSessionId: 'pty_title_12345678',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-title-111111111111111',
          workspaceId: 'goblin+file:///repo',
          canonicalTitle: 'Task',
        },
      },
      {
        type: 'exit',
        event: {
          terminalRuntimeSessionId: 'pty_exit_123456789',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-exit-1111111111111111',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
          tabsBeforeRetirement: null,
        },
      },
    ]
    for (const message of scopedEvents) {
      expect(normalizeTerminalRealtimeMessage(message)).toEqual(message)
      expect(
        normalizeTerminalRealtimeMessage({
          ...message,
          event: { ...message.event, repoRoot: message.event.workspaceId },
        }),
      ).toBeNull()
      const { workspaceId, ...legacyEvent } = message.event
      expect(
        normalizeTerminalRealtimeMessage({ ...message, event: { ...legacyEvent, repoRoot: workspaceId } }),
      ).toBeNull()
    }

    const topLevelEvents = [
      {
        type: 'sessions-changed',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        revision: 1,
      },
      {
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_closed_1234567',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-closed-11111111111111',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        tabsBeforeRetirement: null,
      },
    ]
    for (const message of topLevelEvents) {
      expect(normalizeTerminalRealtimeMessage(message)).toEqual(message)
      expect(normalizeTerminalRealtimeMessage({ ...message, repoRoot: message.workspaceId })).toBeNull()
      const { workspaceId, ...legacyEvent } = message
      expect(normalizeTerminalRealtimeMessage({ ...legacyEvent, repoRoot: workspaceId })).toBeNull()
    }
  })

  test('rejects unsupported terminal create realtime requests', () => {
    const unsupportedCreateRequest = {
      type: 'request',
      requestId: 'request_123',
      action: 'create',
      input: {
        workspaceId: 'goblin+file:///repo',
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        worktreePath: '/repo',
        kind: 'additional',
        workspaceRuntimeId: 'repo-runtime-test',
      },
    }
    expect(normalizeTerminalClientMessage(unsupportedCreateRequest)).toBeNull()
    expect(normalizeAppRealtimeClientMessage(unsupportedCreateRequest)).toBeNull()
  })
})
