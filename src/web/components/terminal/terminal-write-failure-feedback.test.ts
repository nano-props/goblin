// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalWriteFailureReporter } from '#/web/components/terminal/terminal-write-failure-feedback.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

const mocks = vi.hoisted(() => ({ warning: vi.fn() }))

vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }))
vi.mock('i18next', () => ({ t: (key: string) => key }))

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

  test('reports a later outage independently and maps failure kinds', () => {
    const reporter = createTerminalWriteFailureReporter()
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: {
        kind: 'error',
        error: new ClientRealtimeRequestError('unavailable', {
          kind: 'unavailable',
          delivery: 'not-sent',
          outageId: 1,
        }),
      },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: {
        kind: 'error',
        error: new ClientRealtimeRequestError('unavailable again', {
          kind: 'unavailable',
          delivery: 'not-sent',
          outageId: 2,
        }),
      },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_first_123456',
      failure: { kind: 'result', result: { status: 'rejected' } },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_second_123456',
      failure: { kind: 'result', result: { status: 'indeterminate' } },
    })
    reporter.report({
      terminalRuntimeSessionId: 'pty_session_second_123456',
      failure: { kind: 'error', error: new Error('write failed') },
    })

    expect(mocks.warning.mock.calls).toEqual([
      ['terminal.write-not-sent', { id: 'terminal-write-failure:terminal.write-not-sent' }],
      ['terminal.write-not-sent', { id: 'terminal-write-failure:terminal.write-not-sent' }],
      ['terminal.write-blocked-rejected', { id: 'terminal-write-failure:terminal.write-blocked-rejected' }],
      ['terminal.write-delivery-uncertain', { id: 'terminal-write-failure:terminal.write-delivery-uncertain' }],
      ['terminal.write-delivery-uncertain', { id: 'terminal-write-failure:terminal.write-delivery-uncertain' }],
    ])
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
