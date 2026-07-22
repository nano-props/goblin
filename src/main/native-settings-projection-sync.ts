import WebSocket from 'ws'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { isServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import type { NativeHostProjection, NativeSettingsProjectionPatch } from '#/shared/native-host-projection.ts'
import { nativeSettingsProjectionStateFromSettings } from '#/shared/native-host-projection.ts'
import { getSettingsSnapshot } from '#/main/settings-server-client.ts'
import { applyNativeHostProjection } from '#/main/native-host-settings-effects.ts'
import { getEmbeddedServerRuntime } from '#/main/embedded-server-lifecycle.ts'
import { windowNodeLog } from '#/node/logger.ts'

const RECONNECT_DELAY_MS = 300
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let stopped = true
let generation = 0
let authoritativeSnapshot: SettingsSnapshot | null = null
let refreshQueue: Promise<void> = Promise.resolve()

export function startNativeSettingsProjectionSync(initialSnapshot: SettingsSnapshot): void {
  stopNativeSettingsProjectionSync()
  const currentGeneration = generation
  authoritativeSnapshot = initialSnapshot
  stopped = false
  connect(currentGeneration)
}

export function stopNativeSettingsProjectionSync(): void {
  generation += 1
  stopped = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  const current = socket
  socket = null
  current?.close()
  authoritativeSnapshot = null
  refreshQueue = Promise.resolve()
}

function isActiveGeneration(value: number): boolean {
  return !stopped && generation === value
}

function connect(currentGeneration: number): void {
  if (!isActiveGeneration(currentGeneration)) return
  const runtime = getEmbeddedServerRuntime()
  if (!runtime) throw new Error('Embedded server unavailable for native settings projection')
  const url = new URL('/ws/invalidation', runtime.url)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('t', runtime.accessToken)
  const current = new WebSocket(url)
  socket = current
  current.on('open', () => enqueueRefresh(currentGeneration))
  current.on('message', (data) => handleMessage(data.toString(), currentGeneration))
  current.on('error', (error) => windowNodeLog.warn({ err: error }, 'native settings projection socket failed'))
  current.on('close', () => {
    if (socket === current) socket = null
    if (isActiveGeneration(currentGeneration)) {
      reconnectTimer = setTimeout(() => connect(currentGeneration), RECONNECT_DELAY_MS)
    }
  })
}

function handleMessage(raw: string, currentGeneration: number): void {
  if (!isActiveGeneration(currentGeneration)) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    windowNodeLog.warn({ err: error }, 'rejected malformed native settings invalidation')
    return
  }
  if (!isServerInvalidationEvent(parsed)) {
    windowNodeLog.warn({ payload: parsed }, 'rejected invalid native settings invalidation')
    return
  }
  if (parsed.type !== 'settings-invalidated') return
  enqueueRefresh(currentGeneration)
}

function enqueueRefresh(currentGeneration: number): void {
  refreshQueue = refreshQueue
    .then(async () => {
      if (!isActiveGeneration(currentGeneration)) return
      const previous = authoritativeSnapshot
      if (!previous) return
      const current = await getSettingsSnapshot()
      if (!isActiveGeneration(currentGeneration)) return
      const projection = nativeProjectionFromSnapshots(previous, current)
      if (projection) await applyNativeHostProjection(projection)
      if (!isActiveGeneration(currentGeneration)) return
      authoritativeSnapshot = current
    })
    .catch((error) => windowNodeLog.error({ err: error }, 'failed to apply server settings to native host'))
}

export function nativeProjectionFromSnapshots(
  previous: SettingsSnapshot,
  current: SettingsSnapshot,
): NativeHostProjection | null {
  const patch: NativeSettingsProjectionPatch = {}
  if (previous.lang !== current.lang) patch.lang = current.lang
  if (previous.theme !== current.theme) patch.theme = current.theme
  if (previous.colorTheme !== current.colorTheme) patch.colorTheme = current.colorTheme
  if (previous.shortcutsDisabled !== current.shortcutsDisabled) patch.shortcutsDisabled = current.shortcutsDisabled
  if (previous.globalShortcutDisabled !== current.globalShortcutDisabled)
    patch.globalShortcutDisabled = current.globalShortcutDisabled
  if (previous.globalShortcut !== current.globalShortcut) patch.globalShortcut = current.globalShortcut
  const prefs = Object.keys(patch).length
    ? { patch, settings: nativeSettingsProjectionStateFromSettings(current) }
    : undefined
  const recentWorkspaces =
    JSON.stringify(previous.recentWorkspaces) === JSON.stringify(current.recentWorkspaces)
      ? undefined
      : { recentWorkspaces: current.recentWorkspaces }
  return prefs || recentWorkspaces ? { ...(prefs ? { prefs } : {}), ...(recentWorkspaces ? { recentWorkspaces } : {}) } : null
}
