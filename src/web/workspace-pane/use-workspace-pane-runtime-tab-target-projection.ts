import { useMemo } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
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
  filesystemTarget: WorkspacePaneFilesystemExecutionTarget | null
}

export interface WorkspacePaneRuntimeTabTargetProjectionHookResult extends WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabTargetKey: string | null
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
}

export function useWorkspacePaneRuntimeTabTargetProjection({
  workspaceId,
  workspaceRuntimeId,
  filesystemTarget,
}: UseWorkspacePaneRuntimeTabTargetProjectionInput): WorkspacePaneRuntimeTabTargetProjectionHookResult {
  const input = useMemo(
    () => ({ workspaceId, workspaceRuntimeId, filesystemTarget }),
    [filesystemTarget, workspaceId, workspaceRuntimeId],
  )
  const runtimeTabTargetKey = workspacePaneRuntimeTabTargetKey(input)
  const runtimeTabTargetKeyByType = useMemo(() => workspacePaneRuntimeTabTargetKeyByType(input), [input])
  const providerProjections = useWorkspacePaneRuntimeTabProviderProjections(input)

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
