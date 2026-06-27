import { describe, expect, test } from 'vitest'
import {
  markTerminalSessionClosed,
  markTerminalSessionError,
  markTerminalSessionOpen,
  markTerminalSessionOpening,
  markTerminalSessionRestarting,
  type TerminalLifecycleState,
} from '#/server/terminal/terminal-session-lifecycle.ts'

describe('terminal session lifecycle helpers', () => {
  test('drives the session through explicit lifecycle phases', () => {
    const state: TerminalLifecycleState = {
      phase: 'opening',
      message: 'stale',
    }

    markTerminalSessionOpening(state)
    expect(state).toEqual({ phase: 'opening', message: null })

    markTerminalSessionOpen(state)
    expect(state).toEqual({ phase: 'open', message: null })

    markTerminalSessionRestarting(state)
    expect(state).toEqual({ phase: 'restarting', message: null })

    markTerminalSessionError(state, 'pty failed')
    expect(state).toEqual({ phase: 'error', message: 'pty failed' })

    markTerminalSessionClosed(state)
    expect(state).toEqual({ phase: 'closed', message: null })
  })
})
