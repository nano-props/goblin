import type { TerminalSlotPhase } from '#/shared/terminal-types.ts'

export interface TerminalLifecycleState {
  phase: TerminalSlotPhase
  message: string | null
}

export function markTerminalSessionOpening(state: TerminalLifecycleState): void {
  setTerminalSessionPhase(state, 'opening')
}

export function markTerminalSessionRestarting(state: TerminalLifecycleState): void {
  setTerminalSessionPhase(state, 'restarting')
}

export function markTerminalSessionOpen(state: TerminalLifecycleState): void {
  setTerminalSessionPhase(state, 'open')
}

export function markTerminalSessionError(state: TerminalLifecycleState, message: string | null): void {
  setTerminalSessionPhase(state, 'error', message)
}

export function markTerminalSessionClosed(state: TerminalLifecycleState): void {
  setTerminalSessionPhase(state, 'closed')
}

function setTerminalSessionPhase(
  state: TerminalLifecycleState,
  phase: TerminalSlotPhase,
  message: string | null = null,
): void {
  state.phase = phase
  state.message = message
}
