import { describe, expect, test } from 'vitest'
import {
  isValidTerminalAttachmentId,
  isValidTerminalNotifyBellInput,
  isTerminalWsMessageWithinLimit,
  isValidTerminalSize,
  isValidTerminalSessionId,
  normalizeTerminalClientMessage,
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
    expect(isValidTerminalSessionId('term_1234567890abcdef')).toBe(true)
    expect(isValidTerminalSessionId('short')).toBe(false)
    expect(isValidTerminalSessionId('bad id')).toBe(false)

    expect(isValidTerminalAttachmentId(undefined)).toBe(true)
    expect(isValidTerminalAttachmentId('attachment_a')).toBe(true)
    expect(isValidTerminalAttachmentId('bad id')).toBe(false)

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
  })

  test('measures terminal websocket messages in UTF-8 bytes', () => {
    expect('你'.length).toBe(1)
    expect(terminalUtf8ByteLength('你')).toBe(3)
    expect(isTerminalWsMessageWithinLimit('a'.repeat(TERMINAL_WS_MESSAGE_LIMIT_BYTES))).toBe(true)
    expect(isTerminalWsMessageWithinLimit('你'.repeat(Math.floor(TERMINAL_WS_MESSAGE_LIMIT_BYTES / 2)))).toBe(false)
  })

  test('normalizes valid terminal client messages', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'req_1',
        action: 'attach',
        input: { sessionId: 'term_1234567890abcdef', cols: 80, rows: 24, attachmentId: 'attachment_a' },
      }),
    ).toEqual({
      type: 'request',
      requestId: 'req_1',
      action: 'attach',
      input: { sessionId: 'term_1234567890abcdef', cols: 80, rows: 24, attachmentId: 'attachment_a' },
    })

    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'bad id',
        action: 'attach',
        input: { sessionId: 'term_1234567890abcdef', cols: 80, rows: 24 },
      }),
    ).toBeNull()
  })

  test('normalizes workspace pane client message actions', () => {
    expect(
      normalizeTerminalClientMessage({
        type: 'request',
        requestId: 'req_1',
        action: 'workspace-pane:open-view',
        input: { repoRoot: '/repo', worktreePath: '/repo', type: 'changes' },
      }),
    ).toEqual({
      type: 'request',
      requestId: 'req_1',
      action: 'workspace-pane:open-view',
      input: { repoRoot: '/repo', worktreePath: '/repo', type: 'changes' },
    })
  })

  test('normalizes valid terminal socket server messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'output',
        event: { sessionId: 'term_1234567890abcdef', data: 'hi', seq: 1, processName: 'zsh' },
      }),
    ).toEqual({
      type: 'output',
      event: { sessionId: 'term_1234567890abcdef', data: 'hi', seq: 1, processName: 'zsh' },
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
        sessionId: 'session-1',
        repoRoot: '/repo',
      }),
    ).toEqual({
      type: 'session-closed',
      sessionId: 'session-1',
      repoRoot: '/repo',
    })
  })

  test('normalizes workspace pane change realtime messages', () => {
    expect(
      normalizeTerminalSocketServerMessage({
        type: 'workspace-pane-changed',
        repoRoot: '/repo',
      }),
    ).toEqual({
      type: 'workspace-pane-changed',
      repoRoot: '/repo',
    })
  })
})
