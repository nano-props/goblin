import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneRuntimeTabStateInput } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  readWorkspacePaneRuntimeTabProviderProjections,
  type WorkspacePaneRuntimeTabProviderProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export type { WorkspacePaneRuntimeTabTargetSelectionByType } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabViews: WorkspacePaneTabSummary[]
  runtimeTabStateByType: Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabStateInput>
}

export interface WorkspacePaneRuntimeTabTargetProjectionInput {
  providers: readonly WorkspacePaneRuntimeTabProviderProjection[]
}

export function readWorkspacePaneRuntimeTabTargetProjection(input: {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  worktreePath: string | null
}): WorkspacePaneRuntimeTabTargetProjection {
  return workspacePaneRuntimeTabTargetProjection({
    providers: readWorkspacePaneRuntimeTabProviderProjections(input),
  })
}

export function workspacePaneRuntimeTabTargetProjection(
  input: WorkspacePaneRuntimeTabTargetProjectionInput,
): WorkspacePaneRuntimeTabTargetProjection {
  const stateByType: Partial<Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabStateInput>> = {}
  const runtimeTabViews: WorkspacePaneTabSummary[] = []
  for (const provider of input.providers) {
    runtimeTabViews.push(...provider.views)
    stateByType[provider.type] = provider.state
  }
  return {
    runtimeTabViews,
    runtimeTabStateByType: stateByType as Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabStateInput>,
  }
}
