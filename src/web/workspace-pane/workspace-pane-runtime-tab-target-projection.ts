import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceRuntimeTabStateInput } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { WorkspacePaneTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  readWorkspacePaneRuntimeTabProviderProjections,
  type WorkspacePaneRuntimeTabProviderProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export type { WorkspacePaneRuntimeTabTargetSelectionByType } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabViews: WorkspacePaneTabSummary[]
  runtimeTabStateByType: Record<WorkspacePaneRuntimeTabType, RepoWorkspaceRuntimeTabStateInput>
}

export interface WorkspacePaneRuntimeTabTargetProjectionInput {
  providers: readonly WorkspacePaneRuntimeTabProviderProjection[]
}

export function readWorkspacePaneRuntimeTabTargetProjection(input: {
  workspaceId: string
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
  const stateByType: Partial<Record<WorkspacePaneRuntimeTabType, RepoWorkspaceRuntimeTabStateInput>> = {}
  const runtimeTabViews: WorkspacePaneTabSummary[] = []
  for (const provider of input.providers) {
    runtimeTabViews.push(...provider.views)
    stateByType[provider.type] = provider.state
  }
  return {
    runtimeTabViews,
    runtimeTabStateByType: stateByType as Record<WorkspacePaneRuntimeTabType, RepoWorkspaceRuntimeTabStateInput>,
  }
}
