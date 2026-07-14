import type {
  WorkspacePaneTabsEntry,
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'

type MaybePromise<T> = T | Promise<T>

export interface WorkspacePaneTabsInitializeInput extends WorkspacePaneTabsListInput {
  entries: WorkspacePaneTabsEntry[]
}

export interface ServerWorkspacePaneTabsHost {
  initializeTabs(
    userId: string,
    input: WorkspacePaneTabsInitializeInput,
  ): MaybePromise<WorkspacePaneTabsSnapshot>
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
