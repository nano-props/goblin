import { queryOptions, useQuery } from '@tanstack/react-query'
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
  return queryOptions({
    queryKey: workspaceDirectoryOverviewQueryKey(workspaceId, workspaceRuntimeId),
    // The query promise owns this bounded read. A transient observer teardown (including
    // StrictMode replay) may stop observing it, but must not cancel and restart the HTTP request.
    queryFn: () => getWorkspaceDirectoryOverview(workspaceId, workspaceRuntimeId),
    staleTime: 30_000,
    enabled,
    subscribed: enabled,
  })
}

export function useWorkspaceDirectoryOverview(workspaceId: WorkspaceId, workspaceRuntimeId: string, enabled: boolean) {
  return useQuery(workspaceDirectoryOverviewQueryOptions(workspaceId, workspaceRuntimeId, enabled))
}
