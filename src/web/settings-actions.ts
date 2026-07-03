import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { GlobalShortcutState, WorkspaceSessionState } from '#/shared/api-types.ts'
import { settingsLog } from '#/web/logger.ts'
import {
  addRecentRepo,
  clearRecentRepos,
  refreshExternalAppsSnapshot,
  refreshGitHubCliState,
  saveSession,
  setGlobalShortcut as setSettingsGlobalShortcut,
  setGlobalShortcutDisabled as setSettingsGlobalShortcutDisabled,
  setLanEnabled as setSettingsLanEnabled,
  setSettingsFetchInterval,
  setShortcutsDisabled as setSettingsShortcutsDisabled,
  setTerminalNotificationsEnabled as setSettingsTerminalNotificationsEnabled,
} from '#/web/settings-client.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  externalAppsQueryKey,
  lanInfoQueryKey,
  updateGitHubCliCache,
  updateRestorableWorkspaceSessionStateCache,
  updateRuntimeRecentReposStateCache,
  updateRuntimeSettingsSnapshotCache,
} from '#/web/settings-query-cache.ts'

// Settings actions commit to the embedded server first. React Query is the
// window-local projection of that server result, never an independent source.
export async function recordRecentRepo(repo: RepoSessionEntry): Promise<void> {
  const result = await addRecentRepo(repo)
  updateRuntimeRecentReposStateCache(primaryWindowQueryClient, { recentRepos: result.recentRepos })
}

export async function clearRecentRepoHistory(): Promise<void> {
  await clearRecentRepos()
  updateRuntimeRecentReposStateCache(primaryWindowQueryClient, { recentRepos: [] })
}

export async function persistWorkspaceSessionState(session: WorkspaceSessionState): Promise<void> {
  const savedSession = await saveSession(session)
  updateRestorableWorkspaceSessionStateCache(primaryWindowQueryClient, savedSession)
}

export async function setFetchInterval(sec: number): Promise<number> {
  const fetchIntervalSec = await setSettingsFetchInterval(sec)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({ ...current, fetchIntervalSec }))
  return fetchIntervalSec
}

export async function setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
  const terminalNotificationsEnabled = await setSettingsTerminalNotificationsEnabled(enabled)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({
    ...current,
    terminalNotificationsEnabled,
  }))
}

export async function setShortcutsDisabled(disabled: boolean): Promise<void> {
  const shortcutsDisabled = await setSettingsShortcutsDisabled(disabled)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({
    ...current,
    shortcutsDisabled,
  }))
}

export async function setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
  const globalShortcutDisabled = await setSettingsGlobalShortcutDisabled(disabled)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({
    ...current,
    globalShortcutDisabled,
  }))
}

export async function setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState> {
  const state = await setSettingsGlobalShortcut(accelerator)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({
    ...current,
    globalShortcut: state.accelerator,
    globalShortcutRegistered: state.registered,
  }))
  return state
}

export async function refreshExternalAppsDetection(): Promise<void> {
  const state = await refreshExternalAppsSnapshot()
  primaryWindowQueryClient.setQueryData(externalAppsQueryKey(), state)
}

export async function refreshGitHubCliDetection(hosts?: string[]): Promise<void> {
  const state = await refreshGitHubCliState(hosts)
  updateGitHubCliCache(primaryWindowQueryClient, hosts, state)
}

export async function setLanEnabled(enabled: boolean): Promise<void> {
  const lanEnabled = await setSettingsLanEnabled(enabled)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({ ...current, lanEnabled }))
  void primaryWindowQueryClient.invalidateQueries({ queryKey: lanInfoQueryKey() })
}

export async function runSettingsAction<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (err) {
    settingsLog.warn(`${label} failed`, { err })
    return null
  }
}
