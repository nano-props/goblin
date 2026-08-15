import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

export interface WorkspaceRuntimeRecoveryActions {
  request: () => void
}

const workspaceRuntimeRecoveryActionsKey: InjectionKey<WorkspaceRuntimeRecoveryActions> = Symbol(
  'workspace-runtime-recovery-actions',
)

export function provideWorkspaceRuntimeRecoveryActions(actions: WorkspaceRuntimeRecoveryActions): void {
  provide(workspaceRuntimeRecoveryActionsKey, actions)
}

export function useWorkspaceRuntimeRecoveryActions(): WorkspaceRuntimeRecoveryActions {
  const actions = inject(workspaceRuntimeRecoveryActionsKey, null)
  if (!actions) throw new Error('Workspace runtime recovery actions are unavailable')
  return actions
}
