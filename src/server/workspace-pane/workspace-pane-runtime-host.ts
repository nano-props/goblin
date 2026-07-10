import type {
  WorkspacePaneRuntimeCloseInput,
  WorkspacePaneRuntimeCloseResult,
  WorkspacePaneRuntimeCloseWorktreeInput,
  WorkspacePaneRuntimeCloseWorktreeResult,
  WorkspacePaneRuntimeOpenInput,
  WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'

type MaybePromise<T> = T | Promise<T>

export interface ServerWorkspacePaneRuntimeHost {
  openRuntime(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeOpenInput,
  ): MaybePromise<WorkspacePaneRuntimeOpenResult>
  closeRuntime(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeCloseInput,
  ): MaybePromise<WorkspacePaneRuntimeCloseResult>
  closeRuntimeWorktree(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeCloseWorktreeInput,
  ): MaybePromise<WorkspacePaneRuntimeCloseWorktreeResult>
}
