// Actions are the write boundary that commits to the server transport and
// projects server-returned values into TanStack Query.
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceExternalAppTarget } from '#/shared/workspace-settings.ts'
import { settingsLog } from '#/web/logger.ts'
import type { GlobalShortcutState, I18nSnapshot, ThemeState, WorkspaceRestoreResult } from '#/shared/api-types.ts'
import {
  addRecentWorkspace,
  clearRecentWorkspaces,
  refreshExternalAppsSnapshot,
  refreshGitHubCliState,
  restoreWorkspaceTabs,
  restoreServerWorkspace,
  addWorkspaceEntry,
  removeWorkspaceEntry,
  setGlobalShortcut as setSettingsGlobalShortcut,
  setGlobalShortcutDisabled as setSettingsGlobalShortcutDisabled,
  setI18nPref as setSettingsI18nPref,
  setLanEnabled as setSettingsLanEnabled,
  setRecentWorkspaceExternalApp,
  setSettingsFetchInterval,
  setShortcutsDisabled as setSettingsShortcutsDisabled,
  setTerminalNotificationsEnabled as setSettingsTerminalNotificationsEnabled,
  setThemeColorTheme as setSettingsThemeColorTheme,
  setThemePref as setSettingsThemePref,
} from '#/web/settings-client.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import {
  externalAppsQueryKey,
  lanInfoQueryKey,
  updateGitHubCliCache,
  updateWorkspaceSettingsStateCache,
  updateRuntimeRecentWorkspacesStateCache,
  updateRuntimeSettingsSnapshotCache,
} from '#/web/settings-query-cache.ts'

// Settings actions commit to the embedded server first. TanStack Query is the
// window-local projection of that server result, never an independent source.
export async function recordRecentWorkspace(workspace: WorkspaceSessionEntry): Promise<void> {
  const result = await addRecentWorkspace(workspace)
  updateRuntimeRecentWorkspacesStateCache(appQueryClient, { recentWorkspaces: result.recentWorkspaces })
}

export async function clearRecentWorkspaceHistory(): Promise<void> {
  await clearRecentWorkspaces()
  updateRuntimeRecentWorkspacesStateCache(appQueryClient, { recentWorkspaces: [] })
}

export async function restoreWorkspaceAtBoot(
  clientId: string,
  options?: { activeWorkspaceId?: WorkspaceId | null; signal?: AbortSignal },
): Promise<WorkspaceRestoreResult> {
  const restored = await restoreServerWorkspace(clientId, options)
  return restored
}

export async function addWorkspaceToSession(entry: WorkspaceSessionEntry): Promise<void> {
  await addWorkspaceEntry(entry)
}

export async function removeWorkspaceFromSession(workspaceId: WorkspaceId): Promise<void> {
  await removeWorkspaceEntry(workspaceId)
}

/**
 * Lazily projects one workspace runtime and restores its pane tabs when a
 * hydrated workspace stub is first viewed. The server result is committed to
 * the workspace store through its projection hydration boundary.
 */
export async function restoreWorkspaceTabsOnView(
  clientId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  options?: { signal?: AbortSignal },
) {
  return await restoreWorkspaceTabs(clientId, workspaceId, workspaceRuntimeId, options)
}

export async function setFetchInterval(sec: number): Promise<number> {
  const fetchIntervalSec = await setSettingsFetchInterval(sec)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({ ...current, fetchIntervalSec }))
  return fetchIntervalSec
}

export async function setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
  const terminalNotificationsEnabled = await setSettingsTerminalNotificationsEnabled(enabled)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({
    ...current,
    terminalNotificationsEnabled,
  }))
}

export async function setShortcutsDisabled(disabled: boolean): Promise<void> {
  const shortcutsDisabled = await setSettingsShortcutsDisabled(disabled)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({
    ...current,
    shortcutsDisabled,
  }))
}

export async function setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
  const globalShortcutDisabled = await setSettingsGlobalShortcutDisabled(disabled)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({
    ...current,
    globalShortcutDisabled,
  }))
}

export async function setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState> {
  const state = await setSettingsGlobalShortcut(accelerator)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({
    ...current,
    globalShortcut: state.accelerator,
    globalShortcutRegistered: state.registered,
  }))
  return state
}

export async function setThemePreference(pref: ThemePref): Promise<ThemeState> {
  const state = await setSettingsThemePref(pref)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({
    ...current,
    theme: state.pref,
    colorTheme: state.colorTheme,
  }))
  return state
}

export async function setThemeColorThemePreference(colorTheme: ColorTheme): Promise<ThemeState> {
  const state = await setSettingsThemeColorTheme(colorTheme)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({
    ...current,
    theme: state.pref,
    colorTheme: state.colorTheme,
  }))
  return state
}

export async function setI18nPreference(pref: LangPref): Promise<I18nSnapshot> {
  const snapshot = await setSettingsI18nPref(pref)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({ ...current, lang: snapshot.pref }))
  return snapshot
}

export async function refreshExternalAppsDetection(): Promise<void> {
  const state = await refreshExternalAppsSnapshot()
  appQueryClient.setQueryData(externalAppsQueryKey(), state)
}

export async function refreshGitHubCliDetection(hosts?: string[]): Promise<void> {
  const state = await refreshGitHubCliState(hosts)
  updateGitHubCliCache(appQueryClient, hosts, state)
}

export async function setRecentWorkspaceExternalAppPreference(input: {
  workspaceId: WorkspaceId
  target: WorkspaceExternalAppTarget
  itemId: string
}): Promise<void> {
  const state = await setRecentWorkspaceExternalApp(input)
  updateWorkspaceSettingsStateCache(appQueryClient, state)
}

export async function setLanEnabled(enabled: boolean): Promise<void> {
  const lanEnabled = await setSettingsLanEnabled(enabled)
  updateRuntimeSettingsSnapshotCache(appQueryClient, (current) => ({ ...current, lanEnabled }))
  void appQueryClient.invalidateQueries({ queryKey: lanInfoQueryKey() })
}

export async function runSettingsAction<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (err) {
    settingsLog.warn(`${label} failed`, { err })
    return null
  }
}
