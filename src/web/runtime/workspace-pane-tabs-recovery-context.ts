import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface WorkspacePaneTabsRetryActions {
  retryWorkspace: (workspaceId: WorkspaceId) => void
}

const workspacePaneTabsRetryActionsKey: InjectionKey<WorkspacePaneTabsRetryActions> = Symbol(
  'workspace-pane-tabs-retry-actions',
)

export function provideWorkspacePaneTabsRetryActions(actions: WorkspacePaneTabsRetryActions): void {
  provide(workspacePaneTabsRetryActionsKey, actions)
}

export function useWorkspacePaneTabsRetryActions(): WorkspacePaneTabsRetryActions {
  const actions = inject(workspacePaneTabsRetryActionsKey, null)
  if (!actions) throw new Error('Workspace pane tabs retry actions are unavailable')
  return actions
}
