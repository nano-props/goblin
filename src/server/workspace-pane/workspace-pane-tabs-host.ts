import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsEntry,
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'

type MaybePromise<T> = T | Promise<T>

export interface ServerWorkspacePaneTabsHost {
  listWorkspaceTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsListInput,
  ): MaybePromise<WorkspacePaneTabsEntry[]>
  replaceTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsReplaceInput,
  ): MaybePromise<WorkspacePaneTabEntry[]>
  updateTabs(
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsUpdateInput,
  ): MaybePromise<WorkspacePaneTabEntry[]>
}
