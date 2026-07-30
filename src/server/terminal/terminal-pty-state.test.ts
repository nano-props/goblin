import { describe, expect, test } from 'vitest'
import { createEmptyTerminalRenderState, disposeRender } from '#/server/terminal/terminal-render-state.ts'
import {
  advanceTerminalPtyIdentityRevision,
  terminalPtyBoundState,
  terminalPtyGeneration,
  terminalPtyIdentityRevision,
  terminalPtyProcessName,
  type TerminalPtyBoundState,
} from '#/server/terminal/terminal-pty-state.ts'

describe('terminal PTY state', () => {
  test('projects prepared-state defaults without inventing a binding', () => {
    const session = { ptyState: { kind: 'prepared' as const } }

    expect(terminalPtyBoundState(session)).toBeNull()
    expect(terminalPtyGeneration(session)).toBe(0)
    expect(terminalPtyIdentityRevision(session)).toBe(0)
    expect(terminalPtyProcessName(session)).toBe('terminal')
  })

  test('reads and advances identity within the expected generation', () => {
    const state = boundState()
    const session = { ptyState: state }
    try {
      expect(terminalPtyBoundState(session)).toBe(state)
      expect(terminalPtyGeneration(session)).toBe(2)
      expect(terminalPtyIdentityRevision(session)).toBe(4)
      expect(terminalPtyProcessName(session)).toBe('shell')
      expect(advanceTerminalPtyIdentityRevision(session, 2)).toBe(5)
      expect(state.identityRevision).toBe(5)
      expect(() => advanceTerminalPtyIdentityRevision(session, 1)).toThrow(
        'cannot advance identity revision for a stale terminal generation',
      )
    } finally {
      disposeRender(state.render)
    }
  })

  test('rejects identity revision overflow', () => {
    const state = boundState()
    state.identityRevision = Number.MAX_SAFE_INTEGER
    try {
      expect(() => advanceTerminalPtyIdentityRevision({ ptyState: state }, state.generation)).toThrow(
        'terminal identity revision exhausted',
      )
    } finally {
      disposeRender(state.render)
    }
  })
})

function boundState(): TerminalPtyBoundState {
  return {
    kind: 'bound',
    activity: 'active',
    generation: 2,
    identityRevision: 4,
    cols: 80,
    rows: 24,
    processName: 'shell',
    render: createEmptyTerminalRenderState(80, 24),
  }
}
