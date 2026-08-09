import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import {
  type WorkspacePaneRuntimeTabTargetProjection,
  workspacePaneRuntimeTabTargetProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'
import {
  useWorkspacePaneRuntimeTabProviderProjections,
  workspacePaneRuntimeTabTargetKeyByType,
  type WorkspacePaneRuntimeTabTargetKeyByType,
  type WorkspacePaneRuntimeTabTargetSelectionByType,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface UseWorkspacePaneRuntimeTabTargetProjectionInput {
  workspaceId: MaybeRefOrGetter<WorkspaceId>
  workspaceRuntimeId: MaybeRefOrGetter<string>
  filesystemTarget: MaybeRefOrGetter<WorkspacePaneFilesystemExecutionTarget | null>
}

export interface WorkspacePaneRuntimeTabTargetProjectionHookResult extends WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabTargetKey: string | null
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
}

export function useWorkspacePaneRuntimeTabTargetProjection(
  source: UseWorkspacePaneRuntimeTabTargetProjectionInput,
): ComputedRef<WorkspacePaneRuntimeTabTargetProjectionHookResult> {
  const input = computed(() => ({
    workspaceId: toValue(source.workspaceId),
    workspaceRuntimeId: toValue(source.workspaceRuntimeId),
    filesystemTarget: toValue(source.filesystemTarget),
  }))
  const providerProjections = useWorkspacePaneRuntimeTabProviderProjections(input)
  return computed(() => {
    const currentInput = input.value
    const currentProviders = providerProjections.value
    const selectedSessionIdByRuntimeType = Object.fromEntries(
      currentProviders.map((provider) => [provider.type, provider.selectedSessionId]),
    ) as WorkspacePaneRuntimeTabTargetSelectionByType
    const projection = workspacePaneRuntimeTabTargetProjection({ providers: currentProviders })
    return {
      ...projection,
      runtimeTabTargetKey: workspacePaneRuntimeTabTargetKey(currentInput),
      runtimeTabTargetKeyByType: workspacePaneRuntimeTabTargetKeyByType(currentInput),
      selectedSessionIdByRuntimeType,
    }
  })
}
