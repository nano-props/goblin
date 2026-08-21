import type { TerminalSessionPhase } from '#/shared/terminal-types.ts'

export interface TerminalLifecycleState {
  phase: TerminalSessionPhase
  message: string | null
}

/** Returns whether the lifecycle value changed and needs publication. */
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
