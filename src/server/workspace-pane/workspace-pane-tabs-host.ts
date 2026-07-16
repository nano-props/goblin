import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'

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
    input: WorkspacePaneTabsListInput & { targets: WorkspacePaneTabsTarget[]; expectedRepoEntry: WorkspaceSessionEntry },
  ): MaybePromise<WorkspacePaneTabsRestoreResult>
  listWorkspaceTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsListInput,
  ): MaybePromise<WorkspacePaneTabsSnapshot>
  replaceTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsReplaceInput,
  ): MaybePromise<WorkspacePaneTabsSnapshot>
  updateTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsUpdateInput,
  ): MaybePromise<WorkspacePaneTabsSnapshot>
}
