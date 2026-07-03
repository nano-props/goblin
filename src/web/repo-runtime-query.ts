import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { listRepoRuntimeInstances } from '#/web/repo-client.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { RepoRuntimeInstanceEntry, RepoRuntimeInstancesSnapshot } from '#/shared/api-types.ts'

export function repoRuntimeInstancesQueryKey() {
  return ['repo-runtime', 'instances'] as const
}

export function repoRuntimeInstancesQueryOptions() {
  return queryOptions({
    queryKey: repoRuntimeInstancesQueryKey(),
    queryFn: () => listRepoRuntimeInstances(),
  })
}

export function useRepoRuntimeInstancesQuery() {
  return useQuery(repoRuntimeInstancesQueryOptions())
}

export function updateRepoRuntimeInstanceCache(
  entry: RepoRuntimeInstanceEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData<RepoRuntimeInstancesSnapshot>(repoRuntimeInstancesQueryKey(), (current) => {
    const existing = current?.instances ?? []
    const instances = existing.filter((item) => item.repoRoot !== entry.repoRoot)
    instances.push(entry)
    return { instances }
  })
}

export function removeRepoRuntimeInstanceFromCache(
  entry: RepoRuntimeInstanceEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
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
    void queryClient.invalidateQueries({ queryKey: repoRuntimeInstancesQueryKey(), exact: true })
  }
}

export function invalidateRepoRuntimeInstances(queryClient: QueryClient = primaryWindowQueryClient): void {
  void queryClient.invalidateQueries({ queryKey: repoRuntimeInstancesQueryKey(), exact: true })
}
