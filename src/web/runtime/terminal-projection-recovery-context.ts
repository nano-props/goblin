import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface TerminalProjectionRecoveryActions {
  retryWorkspace: (workspaceId: WorkspaceId) => void
}

const terminalProjectionRecoveryActionsKey: InjectionKey<TerminalProjectionRecoveryActions> = Symbol(
  'terminal-projection-recovery-actions',
)

export function provideTerminalProjectionRecoveryActions(actions: TerminalProjectionRecoveryActions): void {
  provide(terminalProjectionRecoveryActionsKey, actions)
}

export function useTerminalProjectionRecoveryActions(): TerminalProjectionRecoveryActions {
  const actions = inject(terminalProjectionRecoveryActionsKey, null)
  if (!actions) throw new Error('Terminal projection recovery actions are unavailable')
  return actions
}
