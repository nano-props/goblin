import type { TerminalSlotPhase } from '#/shared/terminal-types.ts'

export interface TerminalLifecycleState {
  phase: TerminalSlotPhase
  message: string | null
}

export function markTerminalSlotOpening(state: TerminalLifecycleState): void {
  setTerminalSlotPhase(state, 'opening')
}

export function markTerminalSlotRestarting(state: TerminalLifecycleState): void {
  setTerminalSlotPhase(state, 'restarting')
}

export function markTerminalSlotOpen(state: TerminalLifecycleState): void {
  setTerminalSlotPhase(state, 'open')
}

export function markTerminalSlotError(state: TerminalLifecycleState, message: string | null): void {
  setTerminalSlotPhase(state, 'error', message)
}

export function markTerminalSlotClosed(state: TerminalLifecycleState): void {
  setTerminalSlotPhase(state, 'closed')
}

function setTerminalSlotPhase(
  state: TerminalLifecycleState,
  phase: TerminalSlotPhase,
  message: string | null = null,
): void {
  state.phase = phase
  state.message = message
}
