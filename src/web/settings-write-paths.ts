import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { settingsLog } from '#/web/logger.ts'
import type {
  EditorAppState,
  EditorPref,
  GlobalShortcutState,
  SessionState,
  TerminalAppState,
  TerminalPref,
} from '#/shared/api-types.ts'
import {
  addRecentRepo,
  clearRecentRepos,
  refreshExternalAppsSnapshot,
  refreshGitHubCliState,
  saveSession,
  setGlobalShortcut,
  setGlobalShortcutDisabled,
  setLanEnabled,
  setPreferredEditorApp,
  setPreferredTerminalApp,
  setSettingsFetchInterval,
  setShortcutsDisabled,
  setTerminalNotificationsEnabled,
} from '#/web/settings-client.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import {
  externalAppsQueryKey,
  lanInfoQueryKey,
  updateExternalAppsCache,
  updateGitHubCliCache,
  updateRestorableSessionStateCache,
  updateRuntimeRecentReposStateCache,
  updateRuntimeSettingsSnapshotCache,
} from '#/web/settings-query-cache.ts'

export async function recordRecentRepo(repo: RepoSessionEntry): Promise<void> {
  const result = await addRecentRepo(repo)
  updateRuntimeRecentReposStateCache(mainWindowQueryClient, { recentRepos: result.recentRepos })
}

export async function clearRecentRepoHistory(): Promise<void> {
  await clearRecentRepos()
  updateRuntimeRecentReposStateCache(mainWindowQueryClient, { recentRepos: [] })
}

export async function persistSessionState(session: SessionState): Promise<void> {
  const savedSession = await saveSession(session)
  updateRestorableSessionStateCache(mainWindowQueryClient, savedSession)
}

export async function setFetchIntervalPreference(sec: number): Promise<number> {
  const fetchIntervalSec = await setSettingsFetchInterval(sec)
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({ ...current, fetchIntervalSec }))
  return fetchIntervalSec
}

export async function setTerminalNotificationsEnabledPreference(enabled: boolean): Promise<void> {
  await setTerminalNotificationsEnabled(enabled)
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({
    ...current,
    terminalNotificationsEnabled: enabled,
  }))
}

export async function setShortcutsDisabledPreference(disabled: boolean): Promise<void> {
  await setShortcutsDisabled(disabled)
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({ ...current, shortcutsDisabled: disabled }))
}

export async function setGlobalShortcutDisabledPreference(disabled: boolean): Promise<void> {
  await setGlobalShortcutDisabled(disabled)
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({
    ...current,
    globalShortcutDisabled: disabled,
  }))
}

export async function setGlobalShortcutPreference(accelerator: string): Promise<GlobalShortcutState> {
  const state = await setGlobalShortcut(accelerator)
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({
    ...current,
    globalShortcut: state.accelerator,
    globalShortcutRegistered: state.registered,
  }))
  return state
}

export async function setTerminalAppPreference(pref: TerminalPref): Promise<TerminalAppState> {
  const state = await setPreferredTerminalApp(pref)
  updateExternalAppsCache(mainWindowQueryClient, (current) => ({ ...current, terminal: state }))
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({ ...current, terminalApp: state.pref }))
  return state
}

export async function setEditorAppPreference(pref: EditorPref): Promise<EditorAppState> {
  const state = await setPreferredEditorApp(pref)
  updateExternalAppsCache(mainWindowQueryClient, (current) => ({ ...current, editor: state }))
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({ ...current, editorApp: state.pref }))
  return state
}

export async function refreshExternalAppsDetection(): Promise<void> {
  const state = await refreshExternalAppsSnapshot()
  mainWindowQueryClient.setQueryData(externalAppsQueryKey(), state)
}

export async function refreshGitHubCliDetection(hosts?: string[]): Promise<void> {
  const state = await refreshGitHubCliState(hosts)
  updateGitHubCliCache(mainWindowQueryClient, hosts, state)
}

export async function setLanEnabledPreference(enabled: boolean): Promise<void> {
  await setLanEnabled(enabled)
  updateRuntimeSettingsSnapshotCache(mainWindowQueryClient, (current) => ({ ...current, lanEnabled: enabled }))
  void mainWindowQueryClient.invalidateQueries({ queryKey: lanInfoQueryKey() })
}

export async function runSettingsControllerAction<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (err) {
    settingsLog.warn(`${label} failed`, { err })
    return null
  }
}
