import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { RepoRuntimeEntry, RepoRuntimesSnapshot } from '#/shared/api-types.ts'
import { listRepoRuntimes } from '#/web/repo-client.ts'

export function repoRuntimesQueryKey() {
  return ['repo-runtime', 'runtimes'] as const
}

export function repoRuntimesQueryOptions() {
  return queryOptions({
    queryKey: repoRuntimesQueryKey(),
    queryFn: ({ signal }) => listRepoRuntimes(signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export async function refreshRepoRuntimes(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<RepoRuntimesSnapshot> {
  await queryClient.cancelQueries({ queryKey: repoRuntimesQueryKey(), exact: true })
  await queryClient.invalidateQueries({ queryKey: repoRuntimesQueryKey(), exact: true, refetchType: 'none' })
  return await queryClient.fetchQuery(repoRuntimesQueryOptions())
}

export async function updateRepoRuntimeCache(
  entry: RepoRuntimeEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: repoRuntimesQueryKey(), exact: true })
  queryClient.setQueryData<RepoRuntimesSnapshot>(repoRuntimesQueryKey(), (current) => {
    const existing = current?.runtimes ?? []
    const previous = existing.find((item) => item.repoRoot === entry.repoRoot)
    const runtimes = existing.filter((item) => item.repoRoot !== entry.repoRoot)
    runtimes.push({ ...previous, ...entry })
    return { runtimes }
  })
}

export async function removeRepoRuntimeFromCache(
  entry: RepoRuntimeEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: repoRuntimesQueryKey(), exact: true })
  let foundMatchingEntry = false
  queryClient.setQueryData<RepoRuntimesSnapshot>(repoRuntimesQueryKey(), (current) => {
    if (!current) return current
    const runtimes = current.runtimes.filter((item) => {
      const matches = item.repoRoot === entry.repoRoot && item.repoRuntimeId === entry.repoRuntimeId
      if (matches) foundMatchingEntry = true
      return !matches
    })
    return runtimes.length === current.runtimes.length ? current : { runtimes }
  })
  if (!foundMatchingEntry) {
    await refreshRepoRuntimes(queryClient)
  }
}

export async function invalidateRepoRuntimes(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<RepoRuntimesSnapshot> {
  return await refreshRepoRuntimes(queryClient)
}
