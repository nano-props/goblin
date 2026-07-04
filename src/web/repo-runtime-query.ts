import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { RepoRuntimeInstanceEntry, RepoRuntimeInstancesSnapshot } from '#/shared/api-types.ts'
import { listRepoRuntimeInstances } from '#/web/repo-client.ts'

export function repoRuntimeInstancesQueryKey() {
  return ['repo-runtime', 'instances'] as const
}

export function repoRuntimeInstancesQueryOptions() {
  return queryOptions({
    queryKey: repoRuntimeInstancesQueryKey(),
    queryFn: ({ signal }) => listRepoRuntimeInstances(signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export async function refreshRepoRuntimeInstances(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<RepoRuntimeInstancesSnapshot> {
  await queryClient.cancelQueries({ queryKey: repoRuntimeInstancesQueryKey(), exact: true })
  await queryClient.invalidateQueries({ queryKey: repoRuntimeInstancesQueryKey(), exact: true, refetchType: 'none' })
  return await queryClient.fetchQuery(repoRuntimeInstancesQueryOptions())
}

export async function updateRepoRuntimeInstanceCache(
  entry: RepoRuntimeInstanceEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: repoRuntimeInstancesQueryKey(), exact: true })
  queryClient.setQueryData<RepoRuntimeInstancesSnapshot>(repoRuntimeInstancesQueryKey(), (current) => {
    const existing = current?.instances ?? []
    const instances = existing.filter((item) => item.repoRoot !== entry.repoRoot)
    instances.push(entry)
    return { instances }
  })
}

export async function removeRepoRuntimeInstanceFromCache(
  entry: RepoRuntimeInstanceEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: repoRuntimeInstancesQueryKey(), exact: true })
  let foundMatchingEntry = false
  queryClient.setQueryData<RepoRuntimeInstancesSnapshot>(repoRuntimeInstancesQueryKey(), (current) => {
    if (!current) return current
    const instances = current.instances.filter((item) => {
      const matches = item.repoRoot === entry.repoRoot && item.repoInstanceId === entry.repoInstanceId
      if (matches) foundMatchingEntry = true
      return !matches
    })
    return instances.length === current.instances.length ? current : { instances }
  })
  if (!foundMatchingEntry) {
    await refreshRepoRuntimeInstances(queryClient)
  }
}

export async function invalidateRepoRuntimeInstances(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<RepoRuntimeInstancesSnapshot> {
  return await refreshRepoRuntimeInstances(queryClient)
}
