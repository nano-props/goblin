import { canUseGlobalShortcutSettings, canUseNativeIpcBridge } from '#/web/app-shell-client.ts'
import { invokeNativeIpcPath } from '#/web/native-host-client.ts'
import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type {
  EditorAppState,
  EditorPref,
  ExternalAppsSnapshot,
  GitHubCliState,
  GlobalShortcutState,
  I18nSnapshot,
  LangPref,
  LanInfo,
  RuntimeRecentReposState,
  SessionState,
  SettingsPrefs,
  SettingsPrefsUpdateResponse,
  SettingsSnapshot,
  TerminalAppState,
  TerminalPref,
  ThemePref,
  ThemeState,
} from '#/shared/api-types.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
import {
  nativeSettingsProjectionStateFromSettings,
  pickNativeSettingsProjectionPatch,
} from '#/shared/native-shell-projection.ts'
import { runtimeSettingsSnapshotFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'

type RecentReposUpdateResponse = { ok: boolean; addedRepo?: RepoSessionEntry | null } & RuntimeRecentReposState
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  return await fetchServerJson<SettingsSnapshot>('/api/settings')
}

function resolveThemeStateFromPrefs(settings: Pick<SettingsPrefs, 'theme' | 'colorTheme'>): ThemeState {
  const resolved =
    settings.theme === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme
  return { pref: settings.theme, resolved, colorTheme: settings.colorTheme }
}

export function resolveThemeStateFromSettings(settings: Pick<SettingsPrefs, 'theme' | 'colorTheme'>): ThemeState {
  return resolveThemeStateFromPrefs(settings)
}

export async function getThemeState(): Promise<ThemeState> {
  return resolveThemeStateFromSettings(runtimeSettingsSnapshotFromSettingsSnapshot(await getSettingsSnapshot()))
}

async function updateSettingsPrefsPatch(settings: Record<string, unknown>): Promise<SettingsPrefsUpdateResponse> {
  const result = await fetchServerJson<SettingsPrefsUpdateResponse>('/api/settings/prefs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ settings }),
  })
  const patch = pickNativeSettingsProjectionPatch(settings as Partial<SettingsPrefs>)
  if (!patch || !canUseNativeIpcBridge()) return result
  await invokeNativeIpcPath<void>('settings.applyShellProjection', {
    prefs: {
      patch,
      settings: nativeSettingsProjectionStateFromSettings(result.settings),
    },
  })
  return result
}

export async function setThemePref(pref: ThemePref): Promise<ThemeState> {
  return resolveThemeStateFromPrefs((await updateSettingsPrefsPatch({ theme: pref })).settings)
}

export async function setThemeColorTheme(colorTheme: ColorTheme): Promise<ThemeState> {
  return resolveThemeStateFromPrefs((await updateSettingsPrefsPatch({ colorTheme })).settings)
}

export async function getI18nSnapshot(): Promise<I18nSnapshot> {
  return await fetchServerJson<I18nSnapshot>('/api/settings/i18n')
}

export async function setI18nPref(pref: LangPref): Promise<I18nSnapshot> {
  const result = await updateSettingsPrefsPatch({ lang: pref })
  return result.i18n ?? (await getI18nSnapshot())
}

export async function getGitHubCliState(hosts?: string[]): Promise<GitHubCliState> {
  const params = new URLSearchParams()
  for (const host of hosts ?? []) {
    if (host.trim()) params.append('host', host.trim())
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return await fetchServerJson<GitHubCliState>(`/api/settings/github-cli${suffix}`)
}

export async function refreshGitHubCliState(hosts?: string[]): Promise<GitHubCliState> {
  return await postServerJson('/api/settings/github-cli/refresh', hosts && hosts.length > 0 ? { hosts } : {})
}

export async function getLanInfo(): Promise<LanInfo> {
  return await fetchServerJson('/api/settings/lan')
}

export async function setLanEnabled(enabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ lanEnabled: enabled })
}

export async function getExternalAppsSnapshot(): Promise<ExternalAppsSnapshot> {
  return await fetchServerJson<ExternalAppsSnapshot>('/api/settings/external-apps')
}

export async function refreshExternalAppsSnapshot(): Promise<ExternalAppsSnapshot> {
  return await postServerJson('/api/settings/external-apps/refresh', {})
}

export async function addRecentRepo(repo: RepoSessionEntry): Promise<RecentReposUpdateResponse> {
  const result = await postServerJson<{ repo: RepoSessionEntry }, RecentReposUpdateResponse>(
    '/api/settings/recent-repos/add',
    { repo },
  )
  if (canUseNativeIpcBridge()) {
    await invokeNativeIpcPath<void>('settings.applyShellProjection', {
      recentRepos: { recentRepos: result.recentRepos },
    })
  }
  return result
}

export async function clearRecentRepos(): Promise<void> {
  await postServerJson<{}, { ok: boolean }>('/api/settings/recent-repos/clear', {})
  if (!canUseNativeIpcBridge()) return
  await invokeNativeIpcPath<void>('settings.applyShellProjection', {
    recentRepos: { recentRepos: [] },
  })
}

export async function saveSession(session: SessionState): Promise<SessionState> {
  const result = await postServerJson<{ session: SessionState }, { ok: boolean; session: SessionState }>(
    '/api/settings/session',
    { session },
  )
  return result.session
}

/**
 * Push the current workspace layout to the native menu so the menu's
 * `view-toggle-detail` `enabled` predicate — and therefore the
 * CmdOrCtrl+J accelerator — stays in sync with the renderer's store.
 *
 * Renderer is the authority for `workspaceLayout`; main only mirrors
 * the value to drive native menu state. Fire-and-forget: a transient
 * IPC failure just means the menu lags by one rebuild, the next push
 * will catch it up.
 */
export async function pushWorkspaceLayoutToNativeMenu(workspaceLayout: WorkspaceLayout): Promise<void> {
  if (!canUseNativeIpcBridge()) return
  try {
    await invokeNativeIpcPath<boolean>('session.setWorkspaceLayout', { workspaceLayout })
  } catch (err) {
    console.warn('[session] failed to push workspace layout to native menu', err)
  }
}

export async function setSettingsFetchInterval(sec: number): Promise<number> {
  const result = await postServerJson<{ sec: number }, { ok: boolean; fetchIntervalSec: number }>(
    '/api/settings/fetch-interval',
    { sec },
  )
  return result.fetchIntervalSec
}

export async function setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ terminalNotificationsEnabled: enabled })
}

export async function setShortcutsDisabled(disabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ shortcutsDisabled: disabled })
}

export async function setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ globalShortcutDisabled: disabled })
}

export async function setSwapCloseShortcuts(swapped: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ swapCloseShortcuts: swapped })
}

export async function setToggleDetailOnActionBarBlankClick(enabled: boolean): Promise<void> {
  await updateSettingsPrefsPatch({ toggleDetailOnActionBarBlankClick: enabled })
}

export async function setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState> {
  if (!canUseGlobalShortcutSettings()) throw new Error('Global shortcut unavailable')
  return await invokeNativeIpcPath<GlobalShortcutState>('settings.setGlobalShortcut', { accelerator })
}

export async function setPreferredTerminalApp(pref: TerminalPref): Promise<TerminalAppState> {
  const result = await updateSettingsPrefsPatch({ terminalApp: pref })
  return result.externalApps?.terminal ?? (await getExternalAppsSnapshot()).terminal
}

export async function setPreferredEditorApp(pref: EditorPref): Promise<EditorAppState> {
  const result = await updateSettingsPrefsPatch({ editorApp: pref })
  return result.externalApps?.editor ?? (await getExternalAppsSnapshot()).editor
}
