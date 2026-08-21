// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalWriteFailureReporter } from '#/web/terminal/components/terminal-write-failure-feedback.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

const mocks = vi.hoisted(() => ({ warning: vi.fn() }))

vi.mock('vue-sonner', () => ({ toast: { warning: mocks.warning } }))
vi.mock('#/web/stores/i18n-vue.ts', () => ({ translate: (key: string) => key }))

describe('terminal write failure feedback', () => {
  beforeEach(() => {
    mocks.warning.mockClear()
  })

  test('deduplicates failures from the same realtime outage across sessions', () => {
    const reporter = createTerminalWriteFailureReporter()
    const first = new ClientRealtimeRequestError('closed', {
      kind: 'disconnected',
      delivery: 'indeterminate',
      outageId: 4,
    })
    const repeated = new ClientRealtimeRequestError('still closed', {
      kind: 'open-failed',
      delivery: 'not-sent',
      outageId: 4,
    })

    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: { kind: 'error', error: first },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_second_123456',
      failure: { kind: 'error', error: repeated },
    })

    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.warning).toHaveBeenCalledWith('terminal.write-delivery-uncertain', {
      id: 'terminal-write-failure:terminal.write-delivery-uncertain',
    })
  })

  test('reports a later outage independently', () => {
    const reporter = createTerminalWriteFailureReporter()
    for (const outageId of [1, 2]) {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_first_123456',
        failure: {
          kind: 'error',
          error: new ClientRealtimeRequestError('unavailable', {
            kind: 'unavailable',
            delivery: 'not-sent',
            outageId,
          }),
        },
      })
    }

    expect(mocks.warning.mock.calls).toEqual([
      ['terminal.write-not-sent', { id: 'terminal-write-failure:terminal.write-not-sent' }],
      ['terminal.write-not-sent', { id: 'terminal-write-failure:terminal.write-not-sent' }],
    ])
  })

  test.each([
    [
      'not-sent transport failure',
      {
        kind: 'error',
        error: new ClientRealtimeRequestError('unavailable', {
          kind: 'unavailable',
          delivery: 'not-sent',
          outageId: 1,
        }),
      },
      'terminal.write-not-sent',
    ],
    ['server rejection', { kind: 'result', result: { status: 'rejected' } }, 'terminal.write-blocked-rejected'],
    [
      'indeterminate result',
      { kind: 'result', result: { status: 'indeterminate' } },
      'terminal.write-delivery-uncertain',
    ],
    ['unexpected error', { kind: 'error', error: new Error('write failed') }, 'terminal.write-delivery-uncertain'],
  ] as const)('maps %s to the expected feedback', (_scenario, failure, message) => {
    const reporter = createTerminalWriteFailureReporter()

    reporter.report({ terminalRuntimeSessionId: 'pty_session_first_123456', failure })

    expect(mocks.warning).toHaveBeenCalledWith(message, { id: `terminal-write-failure:${message}` })
  })

  test('does not report shutdown as an outage', () => {
    const reporter = createTerminalWriteFailureReporter()
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: {
        kind: 'error',
        error: new ClientRealtimeRequestError('closed', {
          kind: 'app-quitting',
          delivery: 'indeterminate',
          outageId: null,
        }),
      },
    })

    expect(mocks.warning).not.toHaveBeenCalled()
  })

  test('does not re-report a delayed failure from an older outage', () => {
    const reporter = createTerminalWriteFailureReporter()
    for (const outageId of [2, 1]) {
      reporter.report({
        terminalRuntimeSessionId: 'pty_session_first_123456',
        failure: {
          kind: 'error',
          error: new ClientRealtimeRequestError('closed', {
            kind: 'disconnected',
            delivery: 'indeterminate',
            outageId,
          }),
        },
      })
    }

    expect(mocks.warning).toHaveBeenCalledTimes(1)
  })
})
