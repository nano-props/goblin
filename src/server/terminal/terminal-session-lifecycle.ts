import type { TerminalSessionPhase } from '#/shared/terminal-types.ts'

export interface TerminalLifecycleState {
  phase: TerminalSessionPhase
  message: string | null
}

/**
 * All `markTerminalSession*` helpers return `true` when the state
 * actually changed (so the caller can broadcast a lifecycle realtime
 * event) and `false` when the new value is identical to the current
 * one (so the caller can skip the broadcast). Centralising the
 * "did it change" check here keeps the session manager's emitLifecycle
 * call sites honest: identity events are never piggybacked on a
 * lifecycle setter that didn't actually change.
 */
function setTerminalSessionPhase(
  state: TerminalLifecycleState,
  phase: TerminalSessionPhase,
  message: string | null = null,
): boolean {
  if (state.phase === phase && state.message === message) return false
  state.phase = phase
  state.message = message
  return true
}

export function markTerminalSessionOpening(state: TerminalLifecycleState): boolean {
  return setTerminalSessionPhase(state, 'opening')
}

export function markTerminalSessionRestarting(state: TerminalLifecycleState): boolean {
  return setTerminalSessionPhase(state, 'restarting')
}

export function markTerminalSessionOpen(state: TerminalLifecycleState): boolean {
  return setTerminalSessionPhase(state, 'open')
}

export function markTerminalSessionError(state: TerminalLifecycleState, message: string | null): boolean {
  return setTerminalSessionPhase(state, 'error', message)
}

export function markTerminalSessionClosed(state: TerminalLifecycleState): boolean {
  return setTerminalSessionPhase(state, 'closed')
}
