import { describe, expect, test } from 'vitest'
import {
  constrainTerminalSize,
  isValidTerminalClientId,
  isValidTerminalNotifyBellInput,
  isValidTerminalTestNotificationInput,
  isTerminalWsMessageWithinLimit,
  isValidTerminalSize,
  isValidTerminalRuntimeSessionId,
  normalizeTerminalClientMessage,
  normalizeTerminalCreateResult,
  normalizeTerminalRealtimeMessage,
  normalizeTerminalSessionsSnapshot,
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

  test('rejects prune requests without a workspace runtime id', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_125',
        action: 'prune',
        input: {
          workspaceId: 'goblin+file:///repo',
        },
      }),
    ).toBeNull()

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_126',
        action: 'prune',
        input: {
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
        },
      }),
    ).toMatchObject({ type: 'request', action: 'prune' })

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'request_legacy',
        action: 'prune',
        input: {
          repoRoot: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
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
    for (const action of ['recover-sessions', 'prune'] as const) {
      const message = {
        type: 'request',
        requestId: `request_${action}`,
        action,
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
      expect(
        normalizeTerminalClientMessage({ ...message, input: { ...legacyInput, repoRoot: workspaceId } }),
      ).toBeNull()
    }
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

  test('normalizes terminal create results with required prepared-session metadata', () => {
    const normalizedCreateResult = normalizeTerminalCreateResult({
      ok: true,
      action: 'created',
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
      terminalSessionId: 'term-111111111111111111111',
      terminalProjectionEffect: { kind: 'delta', revision: 11 },
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      processName: '',
      canonicalTitle: null,
      phase: 'opening',
      message: null,
      controller: null,
      canonicalSize: null,
    })
    expect(normalizedCreateResult).not.toHaveProperty('sessions')
    expect(normalizedCreateResult).toMatchObject({
      ok: true,
      terminalSessionId: 'term-111111111111111111111',
      terminalProjectionEffect: { kind: 'delta', revision: 11 },
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
    })
    expect(normalizedCreateResult).not.toHaveProperty('tabs')

    expect(
      normalizeTerminalCreateResult({
        ok: true,
        action: 'created',
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 11 },
      }),
    ).toBeNull()
    expect(normalizeTerminalCreateResult({ ok: false, message: 'error.spawn-failed' })).toEqual({
      ok: false,
      message: 'error.spawn-failed',
    })
  })

  test('rejects terminal presentations without a canonical target-compatible branch', () => {
    const metadata = {
      ok: true,
      action: 'created',
      terminalSessionId: 'term-111111111111111111111',
      terminalProjectionEffect: { kind: 'delta', revision: 11 },
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 0,
      processName: '',
      canonicalTitle: null,
      phase: 'opening',
      message: null,
      controller: null,
      canonicalSize: null,
    }
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: '' } },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: '   ' } },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'bad\0branch' } },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalCreateResult({
        ...metadata,
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        branch: 'legacy-main',
      }),
    ).toBeNull()
  })

  test('rejects terminal session snapshots with non-execution or presentation-mismatched targets', () => {
    const session = {
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
      controller: null,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      canonicalSize: { cols: 120, rows: 40 },
      target: {
        kind: 'git-worktree',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        root: 'goblin+file:///repo/worktree',
      },
    }
    expect(normalizeTerminalSessionsSnapshot({ revision: 1, sessions: [session] })).not.toBeNull()
    expect(
      normalizeTerminalSessionsSnapshot({
        revision: 1,
        sessions: [
          {
            ...session,
            target: {
              kind: 'workspace-root',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
            },
          },
        ],
      }),
    ).toBeNull()
    expect(
      normalizeTerminalSessionsSnapshot({
        revision: 1,
        sessions: [
          {
            ...session,
            target: {
              kind: 'git-branch',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
              branch: 'main',
            },
          },
        ],
      }),
    ).toBeNull()
    expect(normalizeTerminalSessionsSnapshot({ revision: 1, sessions: [{ ...session, branch: 'legacy' }] })).toBeNull()

    for (const invalidSession of [
      {
        ...session,
        target: {
          kind: 'workspace-root' as const,
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'repo-runtime-test',
        },
      },
      {
        ...session,
        target: { ...session.target, root: 'goblin+file:///repo/%77orktree' },
      },
      {
        ...session,
        target: { ...session.target, root: 'goblin+file:///C:/repo/worktree' },
      },
    ]) {
      expect(
        normalizeTerminalSocketServerMessage({
          type: 'response',
          requestId: 'req-recover',
          ok: true,
          action: 'recover-sessions',
          payload: { revision: 1, sessions: [invalidSession] },
        }),
      ).toMatchObject({
        type: 'response',
        requestId: 'req-recover',
        ok: false,
        action: 'recover-sessions',
        error: 'Invalid terminal socket response payload',
      })
    }
  })

  test('normalizes valid terminal socket server messages', () => {
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'output',
        event: {
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          data: 'hi',
          seq: 1,
          processName: 'zsh',
        },
      }),
    ).toEqual({
      type: 'output',
      event: {
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hi',
        seq: 1,
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

  test('normalizes runtime-open command responses', () => {
    const payload = {
      ok: true,
      runtimeType: 'terminal',
      paneTabsSnapshot: {
        revision: 7,
        entries: [
          {
            target: {
              kind: 'git-worktree',
              workspaceId: 'goblin+file:///repo',
              workspaceRuntimeId: 'repo-runtime-test',
              root: 'goblin+file:///repo/worktree',
            },
            tabs: [{ type: 'terminal', runtimeSessionId: 'term-111111111111111111111' }],
          },
        ],
      },
      runtime: {
        ok: true,
        action: 'created',
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        terminalSessionId: 'term-111111111111111111111',
        terminalProjectionEffect: { kind: 'delta', revision: 11 },
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 0,
        processName: '',
        canonicalTitle: null,
        phase: 'opening',
        message: null,
        controller: null,
        canonicalSize: null,
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
        requestId: 'request_runtime_open_missing_owner',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, paneTabsSnapshot: { revision: 7, entries: [] } },
      }),
    ).toMatchObject({ ok: false, action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open })
    const workspaceOwner = {
      target: {
        kind: 'workspace-root' as const,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
      },
      tabs: [{ type: 'terminal' as const, runtimeSessionId: 'term-111111111111111111111' }],
    }
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_cross_kind_owner',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, paneTabsSnapshot: { revision: 7, entries: [workspaceOwner] } },
      }),
    ).toMatchObject({ ok: false, action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open })
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_duplicate_owner',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: {
          ...payload,
          paneTabsSnapshot: {
            revision: 7,
            entries: [...payload.paneTabsSnapshot.entries, workspaceOwner],
          },
        },
      }),
    ).toMatchObject({ ok: false, action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open })
    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'request_runtime_open_invalid',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        payload: { ...payload, runtime: { ...payload.runtime, processName: undefined } },
      }),
    ).toMatchObject({
      ok: false,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      error: 'Invalid realtime socket response payload',
    })
  })

  test('normalizes runtime close command responses', () => {
    const effects = [
      {
        action: 'closed' as const,
        terminalSessionId: 'term-111111111111111111111',
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 1,
      },
      {
        action: 'already-closed' as const,
        terminalSessionId: 'term-222222222222222222222',
      },
    ]
    for (const [index, runtime] of effects.entries()) {
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `request_runtime_close_${index}`,
          ok: true,
          action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
          payload: { ok: true, runtimeType: 'terminal', runtime },
        }),
      ).toMatchObject({
        type: 'response',
        ok: true,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        payload: { ok: true, runtimeType: 'terminal', runtime },
      })
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `request_runtime_close_invalid_${index}`,
          ok: true,
          action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
          payload: {
            ok: true,
            runtimeType: 'terminal',
            runtime: { ...runtime, action: 'invalid' },
          },
        }),
      ).toMatchObject({
        ok: false,
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        error: 'Invalid realtime socket response payload',
      })
    }
  })

  test('validates terminal socket success response payloads by action', () => {
    const resizeResponse = {
      type: 'response',
      requestId: 'req_resize',
      ok: true,
      action: 'resize',
      payload: {
        ok: true,
        terminalRuntimeSessionId: 'pty_1234567890abcdef',
        terminalRuntimeGeneration: 3,
        canonicalSize: { cols: 120, rows: 40 },
      },
    } as const
    expect(normalizeAppRealtimeSocketServerMessage(resizeResponse)).toEqual(resizeResponse)
    for (const payload of [
      true,
      { ...resizeResponse.payload, terminalRuntimeGeneration: 0 },
      { ...resizeResponse.payload, canonicalSize: null },
    ]) {
      expect(normalizeAppRealtimeSocketServerMessage({ ...resizeResponse, payload })).toMatchObject({
        ok: false,
        action: 'resize',
        error: 'Invalid terminal socket response payload',
      })
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_takeover',
        ok: true,
        action: 'takeover',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 3,
          role: 'controller',
          controllerStatus: 'connected',
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
          phase: 'open',
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'takeover',
      payload: { ok: true, terminalRuntimeGeneration: 3 },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_takeover_unbound',
        ok: true,
        action: 'takeover',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 0,
          role: 'controller',
          controllerStatus: 'connected',
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
          phase: 'open',
        },
      }),
    ).toMatchObject({ ok: false, error: 'Invalid terminal socket response payload' })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_takeover_missing_generation',
        ok: true,
        action: 'takeover',
        payload: {
          ok: true,
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          role: 'controller',
          controllerStatus: 'connected',
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
          phase: 'open',
        },
      }),
    ).toMatchObject({
      ok: false,
      action: 'takeover',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalProjectionEffect: { kind: 'none' },
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          snapshot: 'prompt',
          snapshotSeq: 1,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: { ok: true, frame: 'snapshot' },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_stream_attach',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'stream',
          terminalProjectionEffect: { kind: 'delta', revision: 2 },
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      action: 'attach',
      payload: { ok: true, frame: 'stream' },
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_unready_stream_attach',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'stream',
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'opening',
          message: null,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_unready_stream_attach',
      ok: false,
      action: 'attach',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_invalid_stream_restart',
        ok: true,
        action: 'restart',
        payload: {
          ok: true,
          frame: 'stream',
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 2,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'opening',
          message: null,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
        },
      }),
    ).toMatchObject({
      type: 'response',
      requestId: 'req_invalid_stream_restart',
      ok: false,
      action: 'restart',
      error: 'Invalid terminal socket response payload',
    })

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'response',
        requestId: 'req_1',
        ok: true,
        action: 'attach',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalRuntimeSessionId: 'pty_1234567890abcdef',
          terminalRuntimeGeneration: 1,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          snapshot: 'prompt',
          snapshotSeq: 1,
          controller: { clientId: 'client_a', status: 'connected' },
          canonicalSize: { cols: 120, rows: 40 },
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
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: 'goblin+file:///repo',
      }),
    ).toEqual({
      type: 'session-closed',
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: 'goblin+file:///repo',
    })
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'session-closed',
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        workspaceId: 'goblin+file:///repo',
        worktreePath: '/repo/worktree',
      }),
    ).toBeNull()
  })

  test('rejects projection effects that contradict terminal frame ownership', () => {
    const metadata = {
      terminalRuntimeSessionId: 'pty_1234567890abcdef',
      terminalRuntimeGeneration: 1,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalSize: { cols: 120, rows: 40 },
    }
    const invalidResponses = [
      {
        action: 'attach',
        payload: { ok: true, frame: 'stream', terminalProjectionEffect: { kind: 'none' }, ...metadata },
      },
      {
        action: 'attach',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalProjectionEffect: { kind: 'delta', revision: 2 },
          snapshot: '',
          snapshotSeq: 0,
          ...metadata,
        },
      },
      {
        action: 'restart',
        payload: {
          ok: true,
          frame: 'snapshot',
          terminalProjectionEffect: { kind: 'none' },
          snapshot: '',
          snapshotSeq: 0,
          ...metadata,
        },
      },
    ]

    for (const [index, response] of invalidResponses.entries()) {
      expect(
        normalizeAppRealtimeSocketServerMessage({
          type: 'response',
          requestId: `invalid_effect_${index}`,
          ok: true,
          ...response,
        }),
      ).toMatchObject({
        type: 'response',
        requestId: `invalid_effect_${index}`,
        ok: false,
        error: 'Invalid terminal socket response payload',
      })
    }
  })

  test('rejects invalid snapshot sequence checkpoints', () => {
    const payload = {
      ok: true,
      frame: 'snapshot',
      terminalProjectionEffect: { kind: 'none' },
      terminalRuntimeSessionId: 'pty_1234567890abcdef',
      terminalRuntimeGeneration: 1,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      snapshot: 'prompt',
      snapshotSeq: 1,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalSize: { cols: 120, rows: 40 },
    } as const

    for (const field of ['snapshotSeq'] as const) {
      for (const [index, value] of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1].entries()) {
        expect(
          normalizeAppRealtimeSocketServerMessage({
            type: 'response',
            requestId: `invalid_${field}_${index}`,
            ok: true,
            action: 'attach',
            payload: { ...payload, [field]: value },
          }),
        ).toMatchObject({
          ok: false,
          action: 'attach',
          error: 'Invalid terminal socket response payload',
        })
      }
    }
  })

  test('normalizes workspace tabs changed realtime messages', () => {
    const messages = [
      {
        type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
        change: 'invalidation' as const,
        workspaceId: 'goblin+file:///repo',
      },
      {
        type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
        change: 'revision' as const,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-test',
        revision: 4,
      },
    ]
    for (const message of messages) {
      expect(normalizeAppRealtimeSocketServerMessage(message)).toEqual(message)
      expect(normalizeAppRealtimeSocketServerMessage({ ...message, repoRoot: message.workspaceId })).toBeNull()
      const { workspaceId, ...legacyMessage } = message
      expect(normalizeAppRealtimeSocketServerMessage({ ...legacyMessage, repoRoot: workspaceId })).toBeNull()
    }

    expect(
      normalizeAppRealtimeSocketServerMessage({
        type: 'workspace-tabs-changed',
        workspaceId: 'goblin+file:///repo',
      }),
    ).toBeNull()
  })
})

describe('terminal runtime generation validation', () => {
  test('requires a bound safe-integer generation on PTY realtime events', () => {
    const message = {
      type: 'exit' as const,
      event: {
        terminalRuntimeSessionId: 'pty_generation_validation',
        terminalSessionId: 'term-generation-validation',
        terminalRuntimeGeneration: 1,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-validation',
      },
    }
    expect(normalizeTerminalRealtimeMessage(message)).toEqual({
      type: 'exit',
      event: {
        terminalRuntimeSessionId: 'pty_generation_validation',
        terminalSessionId: 'term-generation-validation',
        terminalRuntimeGeneration: 1,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-validation',
      },
    })
    expect(
      normalizeTerminalRealtimeMessage({
        ...message,
        event: { ...message.event, terminalRuntimeGeneration: 0 },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalRealtimeMessage({ ...message, event: { ...message.event, workspaceId: undefined } }),
    ).toBeNull()
    expect(
      normalizeTerminalRealtimeMessage({
        ...message,
        event: { ...message.event, workspaceId: undefined, repoRoot: message.event.workspaceId },
      }),
    ).toBeNull()
    expect(
      normalizeTerminalRealtimeMessage({ ...message, event: { ...message.event, workspaceRuntimeId: undefined } }),
    ).toBeNull()
    for (const terminalRuntimeGeneration of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        normalizeTerminalRealtimeMessage({
          ...message,
          event: { ...message.event, terminalRuntimeGeneration },
        }),
      ).toBeNull()
    }
  })

  test('requires non-negative safe-integer output checkpoints', () => {
    const message = {
      type: 'output' as const,
      event: {
        terminalRuntimeSessionId: 'pty_generation_validation',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-generation-validation',
        data: 'output',
        seq: 1,
        processName: 'shell',
      },
    }
    expect(normalizeTerminalRealtimeMessage(message)).toEqual(message)
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(normalizeTerminalRealtimeMessage({ ...message, event: { ...message.event, seq: value } })).toBeNull()
    }
  })
})
