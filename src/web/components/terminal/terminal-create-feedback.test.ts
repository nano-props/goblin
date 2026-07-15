import { describe, expect, test } from 'vitest'
import { terminalCreateErrorKey } from '#/web/components/terminal/terminal-create-feedback.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-socket-connection.ts'

describe('terminalCreateErrorKey', () => {
  test.each([
    [new Error('error.invalid-arguments'), 'error.invalid-arguments'],
    [new Error('Terminal socket open timed out'), 'error.terminal-connection-timeout'],
    [new Error('App realtime socket open timed out'), 'error.terminal-connection-timeout'],
    [new Error('Terminal request timed out'), 'error.terminal-create-timeout'],
    [new Error('App realtime request timed out'), 'error.terminal-create-timeout'],
    [new Error('Terminal socket closed before open'), 'error.terminal-connection-unavailable'],
    [new Error('App realtime socket closed before open'), 'error.terminal-connection-unavailable'],
    [new Error('Terminal socket closed before open (1006)'), 'error.terminal-connection-unavailable'],
    [new Error('App realtime socket closed before open (1006)'), 'error.terminal-connection-unavailable'],
    [new Error('Terminal socket error before open'), 'error.terminal-connection-unavailable'],
    [new Error('App realtime socket error before open'), 'error.terminal-connection-unavailable'],
    [new Error('terminal create geometry wait timed out after 5000ms'), 'error.terminal-host-not-measurable'],
    [new Error('host is inside a display:none subtree'), 'error.terminal-host-not-measurable'],
    [new Error('boom'), 'error.terminal-create-failed'],
  ])('maps %s to %s', (error, expectedKey) => {
    expect(terminalCreateErrorKey(error)).toBe(expectedKey)
  })

  test.each([
    ['open-timeout', 'not-sent', 'error.terminal-connection-timeout'],
    ['timeout', 'indeterminate', 'error.terminal-create-timeout'],
    ['send-failed', 'not-sent', 'error.terminal-connection-unavailable'],
    ['disconnected', 'indeterminate', 'error.terminal-connection-unavailable'],
    ['app-quitting', 'indeterminate', 'error.terminal-create-failed'],
  ] as const)('maps structured %s failures without inspecting message text', (kind, delivery, expectedKey) => {
    const error = new ClientRealtimeRequestError('arbitrary transport detail', {
      kind,
      delivery,
      outageId: kind === 'app-quitting' ? null : 1,
    })

    expect(terminalCreateErrorKey(error)).toBe(expectedKey)
  })
})
