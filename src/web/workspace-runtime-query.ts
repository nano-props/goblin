import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { WorkspaceRuntimeEntry, WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { listWorkspaceRuntimes } from '#/web/workspace-client.ts'

type WorkspaceRuntimeCachePatch = Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId'> & Partial<WorkspaceRuntimeEntry>

export function workspaceRuntimesQueryKey() {
  return ['workspace-runtime', 'runtimes'] as const
}

export function workspaceRuntimesQueryOptions() {
  return queryOptions({
    queryKey: workspaceRuntimesQueryKey(),
    queryFn: ({ signal }) => listWorkspaceRuntimes(signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export async function refreshWorkspaceRuntimes(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<WorkspaceRuntimesSnapshot> {
  await queryClient.cancelQueries({ queryKey: workspaceRuntimesQueryKey(), exact: true })
  await queryClient.invalidateQueries({ queryKey: workspaceRuntimesQueryKey(), exact: true, refetchType: 'none' })
  return await queryClient.fetchQuery(workspaceRuntimesQueryOptions())
}

export async function updateWorkspaceRuntimeCache(
  entry: WorkspaceRuntimeCachePatch,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspaceRuntimesQueryKey(), exact: true })
  queryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), (current) => {
    const existing = current?.runtimes ?? []
    const previous = existing.find((item) => item.workspaceId === entry.workspaceId)
    const runtimes = existing.filter((item) => item.workspaceId !== entry.workspaceId)
    runtimes.push({ workspaceProbe: { status: 'probing' }, ...previous, ...entry })
    return { runtimes }
  })
}

export async function replaceWorkspaceRuntimeCache(
  snapshot: WorkspaceRuntimesSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspaceRuntimesQueryKey(), exact: true })
  queryClient.setQueryData(workspaceRuntimesQueryKey(), snapshot)
}

export async function removeWorkspaceRuntimeFromCache(
  entry: Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId'>,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspaceRuntimesQueryKey(), exact: true })
  let foundMatchingEntry = false
  queryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), (current) => {
    if (!current) return current
    const runtimes = current.runtimes.filter((item) => {
      const matches = item.workspaceId === entry.workspaceId && item.workspaceRuntimeId === entry.workspaceRuntimeId
      if (matches) foundMatchingEntry = true
      return !matches
    })
    return runtimes.length === current.runtimes.length ? current : { runtimes }
  })
  if (!foundMatchingEntry) {
    await refreshWorkspaceRuntimes(queryClient)
  }
}

export async function invalidateWorkspaceRuntimes(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<WorkspaceRuntimesSnapshot> {
  return await refreshWorkspaceRuntimes(queryClient)
}
