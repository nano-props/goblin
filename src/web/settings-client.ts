import { canUseGlobalShortcutSettings, canUseNativeIpcBridge } from '#/web/app-shell-client.ts'
import { invokeNativeIpcPath } from '#/web/native-host-client.ts'
import { sessionLog } from '#/web/logger.ts'
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
  // The embedded server is the authority for settings — the
  // renderer just mirrors them to the native menu. A projection
  // IPC failure here must NOT reject the caller's promise: the
  // server write already succeeded (otherwise `result` would
  // have thrown), the user-facing preference is committed, and
  // the menu will catch up on the next rebuild. Log and move on
  // so a transient menu IPC failure doesn't surface as a
  // settings-write failure to the UI.
  try {
    await invokeNativeIpcPath<void>('settings.applyShellProjection', {
      prefs: {
        patch,
        settings: nativeSettingsProjectionStateFromSettings(result.settings),
      },
    })
  } catch (err) {
    sessionLog.warn(
      'settings.applyShellProjection failed; server write committed, menu will catch up on next rebuild',
      {
        err,
      },
    )
  }
  return result
}

export async function setThemePref(pref: ThemePref): Promise<ThemeState> {
  return resolveThemeStateFromPrefs((await updateSettingsPrefsPatch({ theme: pref })).settings)
}

export async function setThemeColorTheme(colorTheme: ColorTheme): Promise<ThemeState> {
  return resolveThemeStateFromPrefs((await updateSettingsPrefsPatch({ colorTheme })).settings)
}

export async function getI18nSnapshot(options?: { signal?: AbortSignal }): Promise<I18nSnapshot> {
  // Public endpoint — i18n has to be fetchable before the user is
  // authenticated, otherwise the token gate would render with raw
  // i18n keys (the renderer never has a bootstrap on the web path
  // and the server is not inlining anything into HTML anymore).
  return await fetchServerJson<I18nSnapshot>('/api/i18n', { signal: options?.signal })
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
  if (!canUseNativeIpcBridge()) return result
  // See `updateSettingsPrefsPatch` for the rationale: the server
  // is authoritative, the projection is best-effort. A rejected
  // IPC here would previously bubble up as "failed to add recent
  // repo" even though the server write succeeded — the user
  // would see the toast, refresh, and find the repo in the list.
  try {
    await invokeNativeIpcPath<void>('settings.applyShellProjection', {
      recentRepos: { recentRepos: result.recentRepos },
    })
  } catch (err) {
    sessionLog.warn('recent-repos projection IPC failed; server list committed, menu will catch up on next rebuild', {
      err,
    })
  }
  return result
}

export async function clearRecentRepos(): Promise<void> {
  await postServerJson<{}, { ok: boolean }>('/api/settings/recent-repos/clear', {})
  if (!canUseNativeIpcBridge()) return
  // Same projection-best-effort contract as the two paths above:
  // the server has already cleared the list by the time we get
  // here, so an IPC failure must not reject the caller's promise
  // — the user already saw the optimistic "cleared" state.
  try {
    await invokeNativeIpcPath<void>('settings.applyShellProjection', {
      recentRepos: { recentRepos: [] },
    })
  } catch (err) {
    sessionLog.warn(
      'clear-recent-repos projection IPC failed; server list cleared, menu will catch up on next rebuild',
      {
        err,
      },
    )
  }
}

export async function saveSession(session: SessionState): Promise<SessionState> {
  const result = await postServerJson<{ session: SessionState }, { ok: boolean; session: SessionState }>(
    '/api/settings/session',
    { session },
  )
  return result.session
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
