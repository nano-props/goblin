import type { TerminalRenderState } from '#/server/terminal/terminal-render-state.ts'

export type TerminalPtyState =
  | { kind: 'prepared' }
  | {
      kind: 'bound'
      activity: 'active' | 'retained'
      generation: number
      identityRevision: number
      cols: number
      rows: number
      processName: string
      render: TerminalRenderState
    }

export type TerminalPtyBoundState = Extract<TerminalPtyState, { kind: 'bound' }>

interface TerminalPtyStateSource {
  ptyState: TerminalPtyState
}

export function terminalPtyGeneration(session: TerminalPtyStateSource): number {
  return session.ptyState.kind === 'bound' ? session.ptyState.generation : 0
}

export function terminalPtyBoundState(session: TerminalPtyStateSource): TerminalPtyBoundState | null {
  return session.ptyState.kind === 'bound' ? session.ptyState : null
}

export function terminalPtyProcessName(session: TerminalPtyStateSource): string {
  return session.ptyState.kind === 'bound' ? session.ptyState.processName : 'terminal'
}

export function terminalPtyIdentityRevision(session: TerminalPtyStateSource): number {
  return session.ptyState.kind === 'bound' ? session.ptyState.identityRevision : 0
}

export function advanceTerminalPtyIdentityRevision(
  session: TerminalPtyStateSource,
  expectedGeneration: number,
): number {
  const state = terminalPtyBoundState(session)
  if (!state || state.generation !== expectedGeneration) {
    throw new Error('cannot advance identity revision for a stale terminal generation')
  }
  if (state.identityRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error('terminal identity revision exhausted')
  }
  state.identityRevision += 1
  return state.identityRevision
}
