import { canUseGlobalShortcutSettings } from '#/web/app-shell-client.ts'
import { invokeNativeIpcPath } from '#/web/native-host-client.ts'
import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type {
  ExternalAppsSnapshot,
  GitHubCliState,
  GlobalShortcutState,
  I18nSnapshot,
  LangPref,
  LanInfo,
  WorkspaceSettingsState,
  WorkspaceTabsRestoreResult,
  RuntimeRecentWorkspacesState,
  WorkspaceRestoreResult,
  UserSettings,
  UserSettingsUpdateResponse,
  SettingsSnapshot,
  ThemePref,
  ThemeState,
} from '#/shared/api-types.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceExternalAppRecentKey, type WorkspaceExternalAppTarget } from '#/shared/workspace-settings.ts'
import { runtimeSettingsSnapshotFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import * as v from 'valibot'
import { decodeWith } from '#/shared/http-response-schema.ts'
import {
  ExternalAppsSnapshotSchema,
  FetchIntervalSecSchema,
  GitHubCliStateSchema,
  I18nSnapshotSchema,
  LanInfoSchema,
  OkResponseSchema,
  ServerWorkspaceStateSchema,
  SettingsSnapshotSchema,
  UserSettingsUpdateResponseSchema,
  WorkspaceSettingsStateSchema,
  WorkspaceRestoreResponseSchema,
  WorkspaceTabsRestoreResponseSchema,
} from '#/shared/settings-response-schema.ts'
import { WorkspaceSessionEntrySchema } from '#/shared/remote-workspace-schema.ts'

type RecentWorkspacesUpdateResponse = {
  ok: boolean
  addedWorkspace?: WorkspaceSessionEntry | null
} & RuntimeRecentWorkspacesState

export async function getSettingsSnapshot(options?: { signal?: AbortSignal }): Promise<SettingsSnapshot> {
  return await fetchServerJson('/api/settings', decodeWith(SettingsSnapshotSchema), { signal: options?.signal })
}

function resolveThemeStateFromUserSettings(settings: Pick<UserSettings, 'theme' | 'colorTheme'>): ThemeState {
  const resolved =
    settings.theme === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme
  return { pref: settings.theme, resolved, colorTheme: settings.colorTheme }
}

export function resolveThemeStateFromSettings(settings: Pick<UserSettings, 'theme' | 'colorTheme'>): ThemeState {
  return resolveThemeStateFromUserSettings(settings)
}

export async function getThemeState(): Promise<ThemeState> {
  return resolveThemeStateFromSettings(runtimeSettingsSnapshotFromSettingsSnapshot(await getSettingsSnapshot()))
}

async function updateUserSettingsPatch(settings: Record<string, unknown>): Promise<UserSettingsUpdateResponse> {
  const result = await postServerJson(
    '/api/settings/prefs',
    { prefs: settings },
    decodeWith(UserSettingsUpdateResponseSchema),
  )
  return result
}

export async function setThemePref(pref: ThemePref): Promise<ThemeState> {
  return resolveThemeStateFromUserSettings((await updateUserSettingsPatch({ theme: pref })).prefs)
}

export async function setThemeColorTheme(colorTheme: ColorTheme): Promise<ThemeState> {
  return resolveThemeStateFromUserSettings((await updateUserSettingsPatch({ colorTheme })).prefs)
}

export async function getI18nSnapshot(options?: { signal?: AbortSignal }): Promise<I18nSnapshot> {
  // Public endpoint — i18n has to be fetchable before the user is
  // authenticated, otherwise the token gate would render with raw
  // i18n keys (the client never has a bootstrap on the web path
  // and the server is not inlining anything into HTML anymore).
  return await fetchServerJson('/api/i18n', decodeWith(I18nSnapshotSchema), { signal: options?.signal })
}

export async function setI18nPref(pref: LangPref): Promise<I18nSnapshot> {
  const result = await updateUserSettingsPatch({ lang: pref })
  if (!result.i18n) throw new Error('settings language update did not return i18n snapshot')
  return result.i18n
}

export async function getGitHubCliState(hosts?: string[]): Promise<GitHubCliState> {
  const filtered = hosts?.filter((host) => host.trim().length > 0)
  return await postServerJson(
    '/api/settings/github-cli',
    filtered && filtered.length > 0 ? { hosts: filtered } : {},
    decodeWith(GitHubCliStateSchema),
  )
}

export async function refreshGitHubCliState(hosts?: string[]): Promise<GitHubCliState> {
  return await postServerJson(
    '/api/settings/github-cli/refresh',
    hosts && hosts.length > 0 ? { hosts } : {},
    decodeWith(GitHubCliStateSchema),
  )
}

export async function getLanInfo(): Promise<LanInfo> {
  return await fetchServerJson('/api/settings/lan', decodeWith(LanInfoSchema))
}

export async function setLanEnabled(enabled: boolean): Promise<boolean> {
  return (await updateUserSettingsPatch({ lanEnabled: enabled })).prefs.lanEnabled
}

export async function getExternalAppsSnapshot(options?: { signal?: AbortSignal }): Promise<ExternalAppsSnapshot> {
  return await fetchServerJson('/api/settings/external-apps', decodeWith(ExternalAppsSnapshotSchema), {
    signal: options?.signal,
  })
}

export async function refreshExternalAppsSnapshot(): Promise<ExternalAppsSnapshot> {
  return await postServerJson('/api/settings/external-apps/refresh', {}, decodeWith(ExternalAppsSnapshotSchema))
}

export async function addRecentWorkspace(workspace: WorkspaceSessionEntry): Promise<RecentWorkspacesUpdateResponse> {
  const result = await postServerJson(
    '/api/settings/recent-workspaces/add',
    { workspace },
    decodeWith(
      v.strictObject({
        ok: v.literal(true),
        recentWorkspaces: v.array(WorkspaceSessionEntrySchema),
        addedWorkspace: v.nullable(WorkspaceSessionEntrySchema),
      }),
    ),
  )
  return result
}

export async function clearRecentWorkspaces(): Promise<void> {
  await postServerJson('/api/settings/recent-workspaces/clear', {}, decodeWith(OkResponseSchema))
}

/**
 * Record the most recently chosen workspace external app id for a
 * workspace and filesystem-target scope. Callers may update optimistic UI before
 * awaiting this write, but should surface failures and reconcile from
 * the server-driven `settings-snapshot` invalidation on success.
 */
export async function setRecentWorkspaceExternalApp(input: {
  workspaceId: WorkspaceId
  target: WorkspaceExternalAppTarget
  itemId: string
}): Promise<WorkspaceSettingsState> {
  return await postServerJson(
    '/api/settings/workspace-external-app-recent',
    {
      workspaceId: input.workspaceId,
      targetKey: workspaceExternalAppRecentKey(input.target),
      itemId: input.itemId,
    },
    decodeWith(v.strictObject({ ok: v.literal(true), ...WorkspaceSettingsStateSchema.entries })),
  )
}

export async function restoreServerWorkspace(
  clientId: string,
  options?: { activeWorkspaceId?: WorkspaceId | null; signal?: AbortSignal },
): Promise<WorkspaceRestoreResult> {
  return await postServerJson(
    '/api/settings/workspace/restore',
    {
      clientId,
      ...(options && 'activeWorkspaceId' in options ? { activeWorkspaceId: options.activeWorkspaceId } : {}),
    },
    decodeWith(WorkspaceRestoreResponseSchema),
    { signal: options?.signal },
  )
}

export async function addWorkspaceEntry(entry: WorkspaceSessionEntry): Promise<void> {
  await postServerJson('/api/settings/workspace/entries/add', { entry }, decodeWith(ServerWorkspaceStateSchema))
}

export async function removeWorkspaceEntry(workspaceId: WorkspaceId): Promise<void> {
  await postServerJson('/api/settings/workspace/entries/remove', { workspaceId }, decodeWith(ServerWorkspaceStateSchema))
}

export async function restoreWorkspaceTabs(
  clientId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  options?: { signal?: AbortSignal },
): Promise<WorkspaceTabsRestoreResult> {
  return await postServerJson(
    '/api/settings/workspace/tabs/restore',
    { clientId, workspaceId, workspaceRuntimeId },
    decodeWith(WorkspaceTabsRestoreResponseSchema),
    { signal: options?.signal },
  )
}

export async function setSettingsFetchInterval(sec: number): Promise<number> {
  const result = await postServerJson(
    '/api/settings/fetch-interval',
    { sec },
    decodeWith(v.strictObject({ ok: v.literal(true), fetchIntervalSec: FetchIntervalSecSchema })),
  )
  return result.fetchIntervalSec
}

export async function setTerminalNotificationsEnabled(enabled: boolean): Promise<boolean> {
  return (await updateUserSettingsPatch({ terminalNotificationsEnabled: enabled })).prefs.terminalNotificationsEnabled
}

export async function setShortcutsDisabled(disabled: boolean): Promise<boolean> {
  return (await updateUserSettingsPatch({ shortcutsDisabled: disabled })).prefs.shortcutsDisabled
}

export async function setGlobalShortcutDisabled(disabled: boolean): Promise<boolean> {
  return (await updateUserSettingsPatch({ globalShortcutDisabled: disabled })).prefs.globalShortcutDisabled
}

export async function setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState> {
  if (!canUseGlobalShortcutSettings()) throw new Error('Global shortcut unavailable')
  return await invokeNativeIpcPath<GlobalShortcutState>('settings.setGlobalShortcut', { accelerator })
}
