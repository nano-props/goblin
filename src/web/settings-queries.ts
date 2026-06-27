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

function settingsSnapshotQueryOptions() {
  return queryOptions<SettingsSnapshot>({
    queryKey: settingsSnapshotQueryKey(),
    queryFn: getSettingsSnapshot,
    // No initial data from the bootstrap — the server no longer
    // inlines it. The query starts pending and the authenticated
    // bootstrap pass populates the cache.
    staleTime: 0,
    gcTime: 5 * 60_000,
  })
}

function externalAppsQueryOptions() {
  return queryOptions<ExternalAppsSnapshot>({
    queryKey: externalAppsQueryKey(),
    queryFn: getExternalAppsSnapshot,
    // See settingsSnapshotQueryOptions — same rationale.
    staleTime: 0,
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
          void queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryKey(), exact: true })
        }
        if (event.scopes.includes('external-apps')) {
          void queryClient.invalidateQueries({ queryKey: externalAppsQueryKey(), exact: true })
        }
      }),
    [queryClient],
  )
}
