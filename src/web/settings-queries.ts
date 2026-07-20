// Query options are the read boundary for server-backed settings projections.
import { useEffect } from 'react'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExternalAppsSnapshot, GitHubCliState, LanInfo, SettingsSnapshot } from '#/shared/api-types.ts'
import { getExternalAppsSnapshot, getGitHubCliState, getLanInfo, getSettingsSnapshot } from '#/web/settings-client.ts'
import { subscribeSettingsInvalidation } from '#/web/settings-invalidation-ingress.ts'
import {
  externalAppsQueryKey,
  githubCliQueryKey,
  lanInfoQueryKey,
  settingsSnapshotQueryKey,
} from '#/web/settings-query-cache.ts'

function initialGitHubCliState(): GitHubCliState {
  return {
    available: false,
    version: null,
    detectedAt: 0,
    hosts: {},
  }
}

export {
  externalAppsQueryKey,
  githubCliQueryKey,
  lanInfoQueryKey,
  settingsSnapshotQueryKey,
} from '#/web/settings-query-cache.ts'

export function settingsSnapshotQueryOptions() {
  return queryOptions<SettingsSnapshot>({
    queryKey: settingsSnapshotQueryKey(),
    queryFn: ({ signal }) => getSettingsSnapshot({ signal }),
    // No initial data from the bootstrap — the server no longer
    // inlines it. The query starts pending and the authenticated
    // bootstrap pass populates the cache.
    // Settings changes are pushed through the invalidation ingress and local
    // mutations update this cache directly. Keeping a freshly fetched snapshot
    // fresh lets bootstrap and mounted consumers share one authoritative read.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
}

export function externalAppsQueryOptions() {
  return queryOptions<ExternalAppsSnapshot>({
    queryKey: externalAppsQueryKey(),
    queryFn: ({ signal }) => getExternalAppsSnapshot({ signal }),
    // See settingsSnapshotQueryOptions — same rationale.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
}

function githubCliQueryOptions(hosts?: string[]) {
  return queryOptions<GitHubCliState>({
    queryKey: githubCliQueryKey(hosts),
    queryFn: () => getGitHubCliState(hosts),
    initialData: initialGitHubCliState,
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}

function lanInfoQueryOptions() {
  return queryOptions<LanInfo>({
    queryKey: lanInfoQueryKey(),
    queryFn: async () => await getLanInfo(),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })
}

export function useSettingsSnapshotQuery() {
  return useQuery(settingsSnapshotQueryOptions())
}

export function useSettingsSnapshotReadModel(): SettingsSnapshot | undefined {
  return useSettingsSnapshotQuery().data
}

export function useExternalAppsQuery() {
  return useQuery(externalAppsQueryOptions())
}

export function useGitHubCliQuery(hosts?: string[]) {
  return useQuery(githubCliQueryOptions(hosts))
}

export function useLanInfoQuery() {
  return useQuery(lanInfoQueryOptions())
}

export function useSettingsQueryInvalidationSync() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      subscribeSettingsInvalidation((event) => {
        if (event.scopes.includes('settings-snapshot')) {
          void queryClient.refetchQueries({ queryKey: settingsSnapshotQueryKey(), exact: true, type: 'active' })
        }
        if (event.scopes.includes('external-apps')) {
          void queryClient.refetchQueries({ queryKey: externalAppsQueryKey(), exact: true, type: 'active' })
        }
      }),
    [queryClient],
  )
}
