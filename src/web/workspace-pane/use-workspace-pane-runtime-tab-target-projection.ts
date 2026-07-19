import { useMemo } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  type WorkspacePaneRuntimeTabTargetProjection,
  type WorkspacePaneRuntimeTabTargetSelectionByType,
  workspacePaneRuntimeTabTargetProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  useWorkspacePaneRuntimeTabProviderProjections,
  workspacePaneRuntimeTabTargetKeyByType,
  type WorkspacePaneRuntimeTabTargetKeyByType,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface UseWorkspacePaneRuntimeTabTargetProjectionInput {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  worktreePath: string | null
}

export interface WorkspacePaneRuntimeTabTargetProjectionHookResult extends WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabTargetKey: string | null
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
}

export function useWorkspacePaneRuntimeTabTargetProjection({
  workspaceId,
  workspaceRuntimeId,
  worktreePath,
}: UseWorkspacePaneRuntimeTabTargetProjectionInput): WorkspacePaneRuntimeTabTargetProjectionHookResult {
  const runtimeTabTargetKey = workspacePaneRuntimeTabTargetKey({ workspaceId, worktreePath })
  const runtimeTabTargetKeyByType = useMemo(
    () => workspacePaneRuntimeTabTargetKeyByType({ workspaceId, worktreePath }),
    [workspaceId, worktreePath],
  )
  const providerProjections = useWorkspacePaneRuntimeTabProviderProjections({
    workspaceId,
    workspaceRuntimeId,
    worktreePath,
  })

  const selectedSessionIdByRuntimeType = useMemo<WorkspacePaneRuntimeTabTargetSelectionByType>(
    () =>
      Object.fromEntries(
        providerProjections.map((provider) => [provider.type, provider.selectedSessionId]),
      ) as WorkspacePaneRuntimeTabTargetSelectionByType,
    [providerProjections],
  )

  const projection = useMemo(
    () =>
      workspacePaneRuntimeTabTargetProjection({
        providers: providerProjections,
      }),
    [providerProjections],
  )

  return useMemo(
    () => ({
      ...projection,
      runtimeTabTargetKey,
      runtimeTabTargetKeyByType,
      selectedSessionIdByRuntimeType,
    }),
    [projection, runtimeTabTargetKey, runtimeTabTargetKeyByType, selectedSessionIdByRuntimeType],
  )
}
