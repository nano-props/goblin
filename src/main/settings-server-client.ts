import type { SettingsPrefs, SettingsSnapshot, SessionState } from '#/shared/rpc.ts'
import { postEmbeddedServerJson, requestEmbeddedServerJson } from '#/shared/embedded-server-client.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { getEmbeddedServerRuntime } from '#/main/server-manager.ts'

// Main-process client for server-owned settings/session APIs.
export type SettingsPrefsPatch = Partial<SettingsPrefs>

function requireEmbeddedServerRuntime() {
  const runtime = getEmbeddedServerRuntime()
  if (!runtime) throw new Error('Embedded server unavailable')
  return runtime
}

async function requestSettingsJson<T>(
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
  errorMessage?: string,
): Promise<T> {
  const runtime = requireEmbeddedServerRuntime()
  try {
    return await requestEmbeddedServerJson<T>(runtime, path, init)
  } catch (error) {
    throw new Error(
      `${errorMessage ?? 'Embedded server rejected settings request'}${error instanceof Error ? `: ${error.message}` : ''}`,
    )
  }
}

export async function setSettingsFetchInterval(sec: number): Promise<number> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson<{ fetchIntervalSec?: unknown }>(runtime, '/api/settings/fetch-interval', { sec }).catch(
    (error) => {
      throw new Error(`Embedded server rejected fetch interval update${error instanceof Error ? `: ${error.message}` : ''}`)
    },
  )
  if (typeof json?.fetchIntervalSec !== 'number' || !Number.isFinite(json.fetchIntervalSec)) {
    throw new Error('Embedded server returned an invalid fetch interval')
  }
  return json.fetchIntervalSec
}

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  return await requestSettingsJson<SettingsSnapshot>('/api/settings', undefined, 'Embedded server rejected settings snapshot request')
}

export async function updateSettingsPrefs(settings: SettingsPrefsPatch): Promise<SettingsPrefs> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson<{ settings?: SettingsPrefs }>(runtime, '/api/settings/prefs', { settings }).catch(
    (error) => {
      throw new Error(`Embedded server rejected settings update${error instanceof Error ? `: ${error.message}` : ''}`)
    },
  )
  if (!json?.settings) throw new Error('Embedded server returned an invalid settings payload')
  return json.settings
}

export async function getSettingsPrefs(): Promise<SettingsPrefs> {
  return await requestSettingsJson<SettingsPrefs>('/api/settings/prefs', undefined, 'Embedded server rejected settings prefs request')
}

export async function setSettingsGlobalShortcutState(registered: boolean): Promise<boolean> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson<{ registered?: unknown }>(
    runtime,
    '/api/settings/global-shortcut-state',
    { registered },
  ).catch((error) => {
    throw new Error(
      `Embedded server rejected global shortcut state update${error instanceof Error ? `: ${error.message}` : ''}`,
    )
  })
  if (typeof json?.registered !== 'boolean') throw new Error('Embedded server returned an invalid global shortcut state')
  return json.registered
}

export async function saveSettingsSession(session: SessionState): Promise<SessionState> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson<{ session?: SessionState }>(runtime, '/api/settings/session', { session }).catch((error) => {
    throw new Error(`Embedded server rejected session update${error instanceof Error ? `: ${error.message}` : ''}`)
  })
  if (!json?.session) throw new Error('Embedded server returned an invalid session payload')
  return json.session
}

export async function addSettingsRecentRepo(repo: RepoSessionEntry): Promise<RepoSessionEntry[]> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson<{ recentRepos?: RepoSessionEntry[] }>(runtime, '/api/settings/recent-repos/add', {
    repo,
  }).catch((error) => {
    throw new Error(`Embedded server rejected recent repo update${error instanceof Error ? `: ${error.message}` : ''}`)
  })
  if (!Array.isArray(json?.recentRepos)) throw new Error('Embedded server returned an invalid recent repo payload')
  return json.recentRepos
}

export async function clearSettingsRecentRepos(): Promise<boolean> {
  const runtime = requireEmbeddedServerRuntime()
  const json = await postEmbeddedServerJson<{}>(runtime, '/api/settings/recent-repos/clear', {}).catch((error) => {
    throw new Error(`Embedded server rejected recent repo clear${error instanceof Error ? `: ${error.message}` : ''}`)
  })
  return json !== null
}
