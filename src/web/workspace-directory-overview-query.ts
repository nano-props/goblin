import { useQuery } from '@tanstack/react-query'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { getWorkspaceDirectoryOverview } from '#/web/workspace-client.ts'

export function workspaceDirectoryOverviewQueryKey(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  return ['workspace-directory-overview', workspaceId, workspaceRuntimeId] as const
}

export function useWorkspaceDirectoryOverview(workspaceId: WorkspaceId, workspaceRuntimeId: string, enabled: boolean) {
  return useQuery({
    queryKey: workspaceDirectoryOverviewQueryKey(workspaceId, workspaceRuntimeId),
    queryFn: ({ signal }) => getWorkspaceDirectoryOverview(workspaceId, workspaceRuntimeId, signal),
    staleTime: 30_000,
    enabled,
    subscribed: enabled,
  })
}
