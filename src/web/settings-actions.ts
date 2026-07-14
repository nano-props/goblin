// Actions are the write boundary that commits to the server transport and
// projects server-returned values into React Query.
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { settingsLog } from '#/web/logger.ts'
import type { GlobalShortcutState, I18nSnapshot, ThemeState, WorkspaceRestoreResult } from '#/shared/api-types.ts'
import {
  addRecentRepo,
  clearRecentRepos,
  refreshExternalAppsSnapshot,
  refreshGitHubCliState,
  restoreRepoWorkspaceTabs,
  restoreServerWorkspace,
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
  updateRepoSettingsStateCache,
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

export async function restoreWorkspaceAtBoot(
  clientId: string,
  openRepoEntries: RepoSessionEntry[],
  options?: { activeRepoRoot?: string | null; signal?: AbortSignal },
): Promise<WorkspaceRestoreResult> {
  const restored = await restoreServerWorkspace(clientId, openRepoEntries, options)
  return restored
}

/**
 * Lazy per-repo restore: probes + projects + restores pane tabs for a single
 * repo on demand. Triggered by `useRestoreRepoTabsOnView` when the user
 * navigates to a repo that was hydrated as a stub at cold start. Returns the
 * server result so the caller can feed it to the repo store hydration sink.
 */
export async function restoreRepoTabsOnView(
  clientId: string,
  repoRoot: string,
  repoRuntimeId: string,
  entry: RepoSessionEntry,
  options?: { signal?: AbortSignal },
) {
  return await restoreRepoWorkspaceTabs(clientId, repoRoot, repoRuntimeId, entry, options)
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
  repoId: string
  worktreePath: string | null
  itemId: string
}): Promise<void> {
  const state = await setRecentWorkspaceExternalApp(input)
  updateRepoSettingsStateCache(primaryWindowQueryClient, state)
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
