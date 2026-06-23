import { describe, expect, test } from 'vitest'
import {
  markTerminalSlotClosed,
  markTerminalSlotError,
  markTerminalSlotOpen,
  markTerminalSlotOpening,
  markTerminalSlotRestarting,
  type TerminalLifecycleState,
} from '#/server/terminal/terminal-session-lifecycle.ts'

describe('terminal session lifecycle helpers', () => {
  test('drives the session through explicit lifecycle phases', () => {
    const state: TerminalLifecycleState = {
      phase: 'opening',
      message: 'stale',
    }

    markTerminalSlotOpening(state)
    expect(state).toEqual({ phase: 'opening', message: null })

    markTerminalSlotOpen(state)
    expect(state).toEqual({ phase: 'open', message: null })

    markTerminalSlotRestarting(state)
    expect(state).toEqual({ phase: 'restarting', message: null })

    markTerminalSlotError(state, 'pty failed')
    expect(state).toEqual({ phase: 'error', message: 'pty failed' })

    markTerminalSlotClosed(state)
    expect(state).toEqual({ phase: 'closed', message: null })
  })
})
