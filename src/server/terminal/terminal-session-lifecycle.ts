import type { TerminalSlotPhase } from '#/shared/terminal-types.ts'

export interface TerminalLifecycleState {
  phase: TerminalSlotPhase
  message: string | null
}

/**
 * All `markTerminalSlot*` helpers return `true` when the state
 * actually changed (so the caller can broadcast a lifecycle realtime
 * event) and `false` when the new value is identical to the current
 * one (so the caller can skip the broadcast). Centralising the
 * "did it change" check here keeps the slot manager's emitLifecycle
 * call sites honest: identity events are never piggybacked on a
 * lifecycle setter that didn't actually change.
 */
function setTerminalSlotPhase(
  state: TerminalLifecycleState,
  phase: TerminalSlotPhase,
  message: string | null = null,
): boolean {
  if (state.phase === phase && state.message === message) return false
  state.phase = phase
  state.message = message
  return true
}

export function markTerminalSlotOpening(state: TerminalLifecycleState): boolean {
  return setTerminalSlotPhase(state, 'opening')
}

export function markTerminalSlotRestarting(state: TerminalLifecycleState): boolean {
  return setTerminalSlotPhase(state, 'restarting')
}

export function markTerminalSlotOpen(state: TerminalLifecycleState): boolean {
  return setTerminalSlotPhase(state, 'open')
}

export function markTerminalSlotError(state: TerminalLifecycleState, message: string | null): boolean {
  return setTerminalSlotPhase(state, 'error', message)
}

export function markTerminalSlotClosed(state: TerminalLifecycleState): boolean {
  return setTerminalSlotPhase(state, 'closed')
}
