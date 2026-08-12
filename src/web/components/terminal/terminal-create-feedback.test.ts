import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  showTerminalCreateErrorToast,
  terminalCreateErrorKey,
} from '#/web/components/terminal/terminal-create-feedback.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))

vi.mock('vue-sonner', () => ({ toast: toastMocks }))

afterEach(() => {
  vi.clearAllMocks()
})

describe('terminalCreateErrorKey', () => {
  test.each([
    [new Error('error.unavailable'), 'error.terminal-create-failed'],
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
    [new Error('boom'), 'error.terminal-create-failed'],
  ])('maps %s to %s', (error, expectedKey) => {
    expect(terminalCreateErrorKey(error)).toBe(expectedKey)
  })

  test.each([
    ['open-timeout', 'not-sent', 'error.terminal-connection-timeout'],
    ['timeout', 'indeterminate', 'error.operation-outcome-uncertain'],
    ['send-failed', 'not-sent', 'error.terminal-connection-unavailable'],
    ['disconnected', 'indeterminate', 'error.operation-outcome-uncertain'],
    ['invalid-response', 'indeterminate', 'error.operation-outcome-uncertain'],
    ['app-quitting', 'indeterminate', 'error.terminal-create-failed'],
  ] as const)('maps structured %s failures without inspecting message text', (kind, delivery, expectedKey) => {
    const error = new ClientRealtimeRequestError('arbitrary transport detail', {
      kind,
      delivery,
      outageId: kind === 'app-quitting' ? null : 1,
    })

    expect(terminalCreateErrorKey(error)).toBe(expectedKey)
  })

  test('presents an indeterminate create outcome as a warning', () => {
    const error = new ClientRealtimeRequestError('request timed out', {
      kind: 'timeout',
      delivery: 'indeterminate',
      outageId: 1,
    })

    expect(showTerminalCreateErrorToast(error, (key) => key)).toBe('error.operation-outcome-uncertain')
    expect(toastMocks.warning).toHaveBeenCalledWith('error.operation-outcome-uncertain')
    expect(toastMocks.error).not.toHaveBeenCalled()
  })
})
