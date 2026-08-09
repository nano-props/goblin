import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { getWorkspaceDirectoryOverview } from '#/web/workspace-client.ts'

export function workspaceDirectoryOverviewQueryKey(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  return ['workspace-directory-overview', workspaceId, workspaceRuntimeId] as const
}

export function workspaceDirectoryOverviewQueryOptions(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  enabled: boolean,
) {
  return {
    queryKey: workspaceDirectoryOverviewQueryKey(workspaceId, workspaceRuntimeId),
    // The query promise owns this bounded read. A transient observer teardown (including
    // StrictMode replay) may stop observing it, but must not cancel and restart the HTTP request.
    queryFn: () => getWorkspaceDirectoryOverview(workspaceId, workspaceRuntimeId),
    staleTime: 30_000,
    enabled,
  }
}

export function useWorkspaceDirectoryOverview(
  workspaceId: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  return useQuery(
    computed(() =>
      workspaceDirectoryOverviewQueryOptions(toValue(workspaceId), toValue(workspaceRuntimeId), toValue(enabled)),
    ),
  )
}
