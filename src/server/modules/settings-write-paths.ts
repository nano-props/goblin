import { publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  addServerRecentRepo,
  clearServerRecentRepos,
  setServerFetchIntervalSec,
  setServerRepoWorkspaceExternalAppRecent,
  updateUserSettings,
} from '#/server/modules/settings-source.ts'
import type { NativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import { toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import type { RepoSettingsState, UserSettingsUpdateResponse } from '#/shared/api-types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { repoSessionEntryId } from '#/shared/remote-repo.ts'
import { settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

/**
 * Typed inputs for the settings command handlers. The shape is validated at
 * the route perimeter with the valibot schemas in
 * `#/shared/procedure-schemas.ts` (SETTINGS_PROCEDURE_SCHEMAS /
 * SETTINGS_PATCH_SCHEMAS). These types are the boundary contract the
 * modules can rely on — the route layer guarantees well-formed
 * payloads, so the modules no longer need defensive `body as ...`
 * casting.
 */
export interface SetFetchIntervalInput {
  sec: number
}
export interface UpdateUserSettingsInput {
  prefs: Record<string, unknown>
}
export interface SetGlobalShortcutRegisteredInput {
  registered: boolean
}
export interface AddRecentRepoInput {
  repo: RepoSessionEntry
}
export interface SetRepoWorkspaceExternalAppRecentInput {
  repoId: string
  worktreePath: string | null
  itemId: string
}

export async function handleSetFetchInterval(
  input: SetFetchIntervalInput,
): Promise<{ ok: true; fetchIntervalSec: number }> {
  const fetchIntervalSec = await setServerFetchIntervalSec(input.sec)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, fetchIntervalSec }
}

export async function handleUpdateUserSettings(
  input: UpdateUserSettingsInput,
  options: { acceptLanguage?: string; signal: AbortSignal },
): Promise<UserSettingsUpdateResponse> {
  const patch = input.prefs
  const settings = await updateUserSettings(patch)
  publishSettingsInvalidation(settingsInvalidationScopesForPrefsPatch(patch))
  return {
    ok: true,
    prefs: settings,
    ...('lang' in patch ? { i18n: resolveI18nSnapshot(settings.lang, options.acceptLanguage) } : {}),
  }
}

export function handleSetGlobalShortcutRegistered(
  input: SetGlobalShortcutRegisteredInput,
  state: NativeShortcutRegistrationState,
): { ok: true; registered: boolean } {
  const registered = (state.globalShortcutRegistered = input.registered)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, registered }
}

export async function handleAddRecentRepo(
  input: AddRecentRepoInput,
): Promise<{ ok: true; recentRepos: RepoSessionEntry[]; addedRepo: RepoSessionEntry | null }> {
  // The route schema has already confirmed the shape; re-run
  // `toSafeSessionRepoEntry` as a defence in depth check in case the
  // shape ever loosens.
  const requestedRepo = toSafeSessionRepoEntry(input.repo)
  const recentRepos = await addServerRecentRepo(input.repo)
  const addedRepo =
    requestedRepo && recentRepos.length > 0 && repoSessionEntryId(recentRepos[0]) === repoSessionEntryId(requestedRepo)
      ? recentRepos[0]
      : null
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, recentRepos, addedRepo }
}

export async function handleClearRecentRepos(): Promise<{ ok: true }> {
  await clearServerRecentRepos()
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true }
}

export async function handleSetRepoWorkspaceExternalAppRecent(
  input: SetRepoWorkspaceExternalAppRecentInput,
): Promise<{ ok: true } & RepoSettingsState> {
  const repoSettings = await setServerRepoWorkspaceExternalAppRecent(input)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, repoSettings }
}
