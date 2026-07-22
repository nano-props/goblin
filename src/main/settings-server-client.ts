import type { UserSettings, SettingsSnapshot } from '#/shared/api-types.ts'
import * as v from 'valibot'
import { postEmbeddedServerJson, requestEmbeddedServerJson } from '#/shared/embedded-server-client.ts'
import { getEmbeddedServerRuntime } from '#/main/embedded-server-lifecycle.ts'
import {
  GlobalShortcutStateResponseSchema,
  SettingsSnapshotSchema,
  UserSettingsSchema,
  UserSettingsUpdateResponseSchema,
} from '#/shared/settings-response-schema.ts'

// Main-process client for server-owned settings APIs.
export type UserSettingsPatch = Partial<UserSettings>

function requireEmbeddedServerRuntime() {
  const runtime = getEmbeddedServerRuntime()
  if (!runtime) throw new Error('Embedded server unavailable')
  return runtime
}

async function requestSettingsJson<T>(
  path: string,
  decode: (value: unknown) => T,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
  errorMessage?: string,
): Promise<T> {
  const runtime = requireEmbeddedServerRuntime()
  try {
    return await requestEmbeddedServerJson(runtime, path, decode, init)
  } catch (error) {
    throw new Error(
      `${errorMessage ?? 'Embedded server rejected settings request'}${error instanceof Error ? `: ${error.message}` : ''}`,
    )
  }
}

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  return await requestSettingsJson<SettingsSnapshot>(
    '/api/settings',
    (value) => v.parse(SettingsSnapshotSchema, value),
    undefined,
    'Embedded server rejected settings snapshot request',
  )
}

export async function updateUserSettings(settings: UserSettingsPatch): Promise<UserSettings> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson(
    runtime,
    '/api/settings/prefs',
    { prefs: settings },
    (value) => v.parse(UserSettingsUpdateResponseSchema, value),
  ).catch((error) => {
    throw new Error(`Embedded server rejected settings update${error instanceof Error ? `: ${error.message}` : ''}`)
  })
  return json.prefs
}

export async function getUserSettings(): Promise<UserSettings> {
  return await requestSettingsJson<UserSettings>(
    '/api/settings/prefs',
    (value) => v.parse(UserSettingsSchema, value),
    undefined,
    'Embedded server rejected settings prefs request',
  )
}

export async function setGlobalShortcutState(registered: boolean): Promise<boolean> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson(
    runtime,
    '/api/settings/global-shortcut-state',
    { registered },
    (value) => v.parse(GlobalShortcutStateResponseSchema, value),
  ).catch((error) => {
    throw new Error(
      `Embedded server rejected global shortcut state update${error instanceof Error ? `: ${error.message}` : ''}`,
    )
  })
  return json.registered
}
