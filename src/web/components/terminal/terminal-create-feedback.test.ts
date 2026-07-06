import { describe, expect, test } from 'vitest'
import { terminalCreateErrorKey } from '#/web/components/terminal/terminal-create-feedback.ts'

describe('terminalCreateErrorKey', () => {
  test.each([
    [new Error('error.invalid-arguments'), 'error.invalid-arguments'],
    [new Error('Terminal socket open timed out'), 'error.terminal-connection-timeout'],
    [new Error('Terminal request timed out'), 'error.terminal-create-timeout'],
    [new Error('Terminal socket closed before open'), 'error.terminal-connection-unavailable'],
    [new Error('Terminal socket closed before open (1006)'), 'error.terminal-connection-unavailable'],
    [new Error('Terminal socket error before open'), 'error.terminal-connection-unavailable'],
    [new Error('terminal create geometry wait timed out after 5000ms'), 'error.terminal-host-not-measurable'],
    [new Error('host is inside a display:none subtree'), 'error.terminal-host-not-measurable'],
    [new Error('boom'), 'error.terminal-create-failed'],
  ])('maps %s to %s', (error, expectedKey) => {
    expect(terminalCreateErrorKey(error)).toBe(expectedKey)
  })
})
