import type { QueryClient } from '@tanstack/react-query'
import type {
  ExternalAppsSnapshot,
  GitHubCliState,
  RepoSettingsState,
  RuntimeRecentWorkspacesState,
  RuntimeSettingsSnapshot,
  SettingsSnapshot,
} from '#/shared/api-types.ts'
import { runtimeSettingsSnapshotFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'

export function settingsSnapshotQueryKey() {
  return ['settings', 'snapshot'] as const
}

export function externalAppsQueryKey() {
  return ['settings', 'external-apps'] as const
}

export function githubCliQueryKey(hosts?: string[]) {
  return ['settings', 'github-cli', ...(hosts?.filter((host) => host.trim()).sort() ?? [])] as const
}

export function lanInfoQueryKey() {
  return ['settings', 'lan'] as const
}

export function updateSettingsSnapshotCache(
  queryClient: QueryClient,
  update: (current: SettingsSnapshot) => SettingsSnapshot,
): void {
  queryClient.setQueryData(settingsSnapshotQueryKey(), (current: SettingsSnapshot | undefined) =>
    current ? update(current) : current,
  )
}

export function updateRuntimeSettingsSnapshotCache(
  queryClient: QueryClient,
  update: (current: RuntimeSettingsSnapshot) => RuntimeSettingsSnapshot,
): void {
  updateSettingsSnapshotCache(queryClient, (current) => ({
    ...current,
    ...update(runtimeSettingsSnapshotFromSettingsSnapshot(current)),
  }))
}

export function updateRuntimeRecentWorkspacesStateCache(queryClient: QueryClient, next: RuntimeRecentWorkspacesState): void {
  updateSettingsSnapshotCache(queryClient, (current) => ({
    ...current,
    recentWorkspaces: next.recentWorkspaces,
  }))
}

export function updateRepoSettingsStateCache(queryClient: QueryClient, next: RepoSettingsState): void {
  updateSettingsSnapshotCache(queryClient, (current) => ({
    ...current,
    repoSettings: next.repoSettings,
  }))
}

export function updateExternalAppsCache(
  queryClient: QueryClient,
  update: (current: ExternalAppsSnapshot) => ExternalAppsSnapshot,
): void {
  queryClient.setQueryData(externalAppsQueryKey(), (current: ExternalAppsSnapshot | undefined) =>
    current ? update(current) : current,
  )
}

export function updateGitHubCliCache(
  queryClient: QueryClient,
  hosts: string[] | undefined,
  state: GitHubCliState,
): void {
  queryClient.setQueryData(githubCliQueryKey(hosts), state)
  if (!hosts || hosts.length === 0) queryClient.setQueryData(githubCliQueryKey(), state)
}
