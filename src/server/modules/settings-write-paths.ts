import { publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  addServerRecentRepo,
  clearServerRecentRepos,
  setServerFetchIntervalSec,
  setServerSessionState,
  updateServerSettingsPrefs,
} from '#/server/modules/settings-source.ts'
import type { ServerSettingsState } from '#/server/modules/settings-state.ts'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import { toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import type { SessionState, SettingsPrefsUpdateResponse } from '#/shared/api-types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { repoSessionEntryId } from '#/shared/remote-repo.ts'
import { settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

/**
 * Typed inputs for the settings write paths. The shape is validated at
 * the route perimeter with the valibot schemas in
 * `#/shared/procedure-schemas.ts` (SETTINGS_PROCEDURE_SCHEMAS /
 * SETTINGS_PATCH_SCHEMAS). These types are the boundary contract the
 * modules can rely on — the route layer guarantees well-formed
 * payloads, so the modules no longer need defensive `body as ...`
 * casting.
 */
export interface ApplyServerFetchIntervalInput {
  sec: number
}
export interface ApplyServerSettingsPrefsInput {
  settings: Record<string, unknown>
}
export interface ApplyServerGlobalShortcutRegistrationInput {
  registered: boolean
}
export interface ApplyServerSessionInput {
  session: SessionState
}
export interface ApplyServerRecentRepoAddInput {
  repo: RepoSessionEntry
}

export async function applyServerFetchIntervalWrite(
  input: ApplyServerFetchIntervalInput,
): Promise<{ ok: true; fetchIntervalSec: number }> {
  const fetchIntervalSec = await setServerFetchIntervalSec(input.sec)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, fetchIntervalSec }
}

export async function applyServerSettingsPrefsWrite(
  input: ApplyServerSettingsPrefsInput,
  options: { acceptLanguage?: string; signal: AbortSignal },
): Promise<SettingsPrefsUpdateResponse> {
  const patch = input.settings
  const settings = await updateServerSettingsPrefs(patch)
  publishSettingsInvalidation(settingsInvalidationScopesForPrefsPatch(patch))
  return {
    ok: true,
    settings,
    ...('lang' in patch ? { i18n: resolveI18nSnapshot(settings.lang, options.acceptLanguage) } : {}),
  }
}

export function applyServerGlobalShortcutRegistrationWrite(
  input: ApplyServerGlobalShortcutRegistrationInput,
  state: ServerSettingsState,
): { ok: true; registered: boolean } {
  const registered = (state.globalShortcutRegistered = input.registered)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, registered }
}

export async function applyServerSessionWrite(
  input: ApplyServerSessionInput,
): Promise<{ ok: true; session: SessionState }> {
  const session = await setServerSessionState(input.session)
  return { ok: true, session }
}

export async function applyServerRecentRepoAddWrite(
  input: ApplyServerRecentRepoAddInput,
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

export async function applyServerRecentRepoClearWrite(): Promise<{ ok: true }> {
  await clearServerRecentRepos()
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true }
}
