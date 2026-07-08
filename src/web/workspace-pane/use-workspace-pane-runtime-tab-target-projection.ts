import { useMemo } from 'react'
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
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
}

export interface WorkspacePaneRuntimeTabTargetProjectionHookResult extends WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabTargetKey: string | null
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
}

export function useWorkspacePaneRuntimeTabTargetProjection({
  repoRoot,
  repoInstanceId,
  worktreePath,
}: UseWorkspacePaneRuntimeTabTargetProjectionInput): WorkspacePaneRuntimeTabTargetProjectionHookResult {
  const runtimeTabTargetKey = workspacePaneRuntimeTabTargetKey({ repoRoot, worktreePath })
  const runtimeTabTargetKeyByType = useMemo(
    () => workspacePaneRuntimeTabTargetKeyByType({ repoRoot, worktreePath }),
    [repoRoot, worktreePath],
  )
  const providerProjections = useWorkspacePaneRuntimeTabProviderProjections({
    repoRoot,
    repoInstanceId,
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
