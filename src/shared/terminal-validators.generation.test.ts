import { describe, expect, test } from 'vitest'
import {
  constrainTerminalSize,
  isValidTerminalClientId,
  isValidTerminalNotifyBellInput,
  isValidTerminalTestNotificationInput,
  isTerminalWsMessageWithinLimit,
  isValidTerminalSize,
  isValidTerminalRuntimeSessionId,
  isValidTerminalWriteData,
  MAX_TERMINAL_WRITE_CHARS,
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

describe('shared terminal validators generation', () => {
  test('requires a non-negative safe-integer identity revision on identity events', () => {
    const message = {
      type: 'identity' as const,
      event: {
        terminalRuntimeSessionId: 'pty_identity_validation',
        terminalRuntimeGeneration: 1,
        identityRevision: 0,
        terminalSessionId: 'term-identity-validation',
        controller: { clientId: 'client_identity_validation', status: 'connected' as const },
        canonicalSize: { cols: 80, rows: 24 },
      },
    }
    expect(normalizeTerminalRealtimeMessage(message)).toEqual(message)
    for (const identityRevision of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        normalizeTerminalRealtimeMessage({
          ...message,
          event: { ...message.event, identityRevision },
        }),
      ).toBeNull()
    }
  })

  test('requires a bound safe-integer generation on PTY realtime events', () => {
    const message = {
      type: 'exit' as const,
      event: {
        terminalRuntimeSessionId: 'pty_generation_validation',
        terminalSessionId: 'term-generation-validation',
        terminalRuntimeGeneration: 1,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-validation',
        tabsBeforeRetirement: null,
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
        tabsBeforeRetirement: null,
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
