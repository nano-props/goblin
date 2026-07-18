// Actions are the write boundary that commits to the server transport and
// projects server-returned values into React Query.
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
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
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  externalAppsQueryKey,
  lanInfoQueryKey,
  updateGitHubCliCache,
  updateWorkspaceSettingsStateCache,
  updateRuntimeRecentWorkspacesStateCache,
  updateRuntimeSettingsSnapshotCache,
} from '#/web/settings-query-cache.ts'

// Settings actions commit to the embedded server first. React Query is the
// window-local projection of that server result, never an independent source.
export async function recordRecentWorkspace(workspace: WorkspaceSessionEntry): Promise<void> {
  const result = await addRecentWorkspace(workspace)
  updateRuntimeRecentWorkspacesStateCache(primaryWindowQueryClient, { recentWorkspaces: result.recentWorkspaces })
}

export async function clearRecentWorkspaceHistory(): Promise<void> {
  await clearRecentWorkspaces()
  updateRuntimeRecentWorkspacesStateCache(primaryWindowQueryClient, { recentWorkspaces: [] })
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

export async function setThemePreference(pref: ThemePref): Promise<ThemeState> {
  const state = await setSettingsThemePref(pref)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({
    ...current,
    theme: state.pref,
    colorTheme: state.colorTheme,
  }))
  return state
}

export async function setThemeColorThemePreference(colorTheme: ColorTheme): Promise<ThemeState> {
  const state = await setSettingsThemeColorTheme(colorTheme)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({
    ...current,
    theme: state.pref,
    colorTheme: state.colorTheme,
  }))
  return state
}

export async function setI18nPreference(pref: LangPref): Promise<I18nSnapshot> {
  const snapshot = await setSettingsI18nPref(pref)
  updateRuntimeSettingsSnapshotCache(primaryWindowQueryClient, (current) => ({ ...current, lang: snapshot.pref }))
  return snapshot
}

export async function refreshExternalAppsDetection(): Promise<void> {
  const state = await refreshExternalAppsSnapshot()
  primaryWindowQueryClient.setQueryData(externalAppsQueryKey(), state)
}

export async function refreshGitHubCliDetection(hosts?: string[]): Promise<void> {
  const state = await refreshGitHubCliState(hosts)
  updateGitHubCliCache(primaryWindowQueryClient, hosts, state)
}

export async function setRecentWorkspaceExternalAppPreference(input: {
  workspaceId: WorkspaceId
  worktreePath: string | null
  itemId: string
}): Promise<void> {
  const state = await setRecentWorkspaceExternalApp(input)
  updateWorkspaceSettingsStateCache(primaryWindowQueryClient, state)
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
