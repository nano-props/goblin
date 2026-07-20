import { publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  addServerRecentWorkspace,
  clearServerRecentWorkspaces,
  setServerFetchIntervalSec,
  setServerWorkspaceExternalAppRecent,
  updateUserSettings,
} from '#/server/modules/settings-source.ts'
import type { NativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import type { WorkspaceSettingsState, UserSettingsUpdateResponse } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceSessionEntryId } from '#/shared/remote-workspace.ts'
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
export interface AddRecentWorkspaceInput {
  workspace: WorkspaceSessionEntry
}
export interface SetWorkspaceExternalAppRecentInput {
  workspaceId: WorkspaceId
  targetKey: string
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

export async function handleAddRecentWorkspace(
  input: AddRecentWorkspaceInput,
): Promise<{ ok: true; recentWorkspaces: WorkspaceSessionEntry[]; addedWorkspace: WorkspaceSessionEntry | null }> {
  const recentWorkspaces = await addServerRecentWorkspace(input.workspace)
  const addedWorkspace =
    recentWorkspaces.length > 0 &&
    workspaceSessionEntryId(recentWorkspaces[0]) === workspaceSessionEntryId(input.workspace)
      ? recentWorkspaces[0]
      : null
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, recentWorkspaces, addedWorkspace }
}

export async function handleClearRecentWorkspaces(): Promise<{ ok: true }> {
  await clearServerRecentWorkspaces()
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true }
}

export async function handleSetWorkspaceExternalAppRecent(
  input: SetWorkspaceExternalAppRecentInput,
): Promise<{ ok: true } & WorkspaceSettingsState> {
  const workspaceSettings = await setServerWorkspaceExternalAppRecent(input)
  publishSettingsInvalidation(['settings-snapshot'])
  return { ok: true, workspaceSettings }
}
