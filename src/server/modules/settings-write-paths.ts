import { publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import { buildServerExternalAppsSnapshot } from '#/server/modules/external-apps.ts'
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
import type { SessionState, SettingsPrefsUpdateResponse } from '#/shared/rpc.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { repoSessionEntryId } from '#/shared/remote-repo.ts'
import { settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

export async function applyServerFetchIntervalWrite(body: unknown): Promise<{ ok: true; fetchIntervalSec: number }> {
  const sec = typeof (body as { sec?: unknown } | null)?.sec === 'number' ? (body as { sec: number }).sec : 0
  const fetchIntervalSec = await setServerFetchIntervalSec(sec)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, fetchIntervalSec }
}

export async function applyServerSettingsPrefsWrite(
  body: unknown,
  options: { acceptLanguage?: string; signal: AbortSignal },
): Promise<SettingsPrefsUpdateResponse> {
  const patch = ((body as { settings?: unknown } | null)?.settings ?? {}) as Record<string, unknown>
  const settings = await updateServerSettingsPrefs(patch)
  publishSettingsInvalidation(settingsInvalidationScopesForPrefsPatch(patch))
  return {
    ok: true,
    settings,
    ...('lang' in patch ? { i18n: resolveI18nSnapshot(settings.lang, options.acceptLanguage) } : {}),
    ...(patch.terminalApp !== undefined || patch.editorApp !== undefined
      ? { externalApps: await buildServerExternalAppsSnapshot(settings, options.signal) }
      : {}),
  }
}

export function applyServerGlobalShortcutRegistrationWrite(
  body: unknown,
  state: ServerSettingsState,
): { ok: true; registered: boolean } {
  const registered = (state.globalShortcutRegistered = (body as { registered?: unknown } | null)?.registered === true)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, registered }
}

export async function applyServerSessionWrite(body: unknown): Promise<{ ok: true; session: SessionState }> {
  const session = await setServerSessionState((body as { session?: SessionState } | null)?.session as SessionState)
  return { ok: true, session }
}

export async function applyServerRecentRepoAddWrite(
  body: unknown,
): Promise<{ ok: true; recentRepos: RepoSessionEntry[]; addedRepo: RepoSessionEntry | null }> {
  const requestedRepo = toSafeSessionRepoEntry((body as { repo?: unknown } | null)?.repo)
  const recentRepos = await addServerRecentRepo((body as { repo?: unknown } | null)?.repo as RepoSessionEntry)
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
