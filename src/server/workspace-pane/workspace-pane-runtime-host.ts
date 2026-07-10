import type { WorkspacePaneRuntimeOpenInput, WorkspacePaneRuntimeOpenResult } from '#/shared/workspace-pane-runtime.ts'

type MaybePromise<T> = T | Promise<T>

export interface ServerWorkspacePaneRuntimeHost {
  openRuntime(
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeOpenInput,
  ): MaybePromise<WorkspacePaneRuntimeOpenResult>
}
