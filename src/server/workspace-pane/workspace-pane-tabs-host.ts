import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
  WorkspacePaneTabsWriteResult,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceRuntimeMembershipCapability } from '#/server/modules/workspace-runtimes.ts'

type MaybePromise<T> = T | Promise<T>

export interface WorkspacePaneTabsMembershipConflict {
  kind: 'membership-conflict'
}

export interface WorkspacePaneTabsRestored {
  kind: 'restored'
  snapshot: WorkspacePaneTabsSnapshot
  repaired: boolean
}

export type WorkspacePaneTabsRestoreResult = WorkspacePaneTabsRestored | WorkspacePaneTabsMembershipConflict

export interface ServerWorkspacePaneTabsHost {
  restoreTabs(
    userId: string,
    input: WorkspacePaneTabsListInput & {
      targets: RestorableWorkspacePaneTarget[]
      expectedWorkspaceEntry: WorkspaceSessionEntry
    },
    runtimeCapability: WorkspaceRuntimeMembershipCapability,
  ): MaybePromise<WorkspacePaneTabsRestoreResult>
  listWorkspaceTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsListInput,
  ): MaybePromise<WorkspacePaneTabsSnapshot>
  updateTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsUpdateInput,
  ): MaybePromise<WorkspacePaneTabsWriteResult>
}
