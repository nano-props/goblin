import type { RendererBootstrapSnapshot, RendererPlatform, RendererRuntimeSnapshot } from '#/shared/bootstrap.ts'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

/**
 * Web-hosted renderers have no host OS, so we fall back to a sentinel
 * 'web' platform. Settings pages branch on this to hide OS-specific
 * entries (e.g. Windows Terminal) in the browser preview build.
 */
const EMPTY_BOOTSTRAP: RendererBootstrapSnapshot = {
  runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
  homeDir: '',
  platform: 'web',
  initialI18n: null,
  initialSettings: null,
  initialServer: null,
}

function isRendererRuntimeSnapshot(value: unknown): value is RendererRuntimeSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RendererRuntimeSnapshot>
  return (
    (candidate.kind === 'electron' || candidate.kind === 'web') &&
    typeof candidate.bridgeVersion === 'number' &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every((capability) => typeof capability === 'string')
  )
}

function isRendererPlatform(value: unknown): value is RendererPlatform {
  if (typeof value !== 'string') return false
  // Mirror the union in shared/bootstrap.ts. Kept as a runtime allowlist
  // so a stale or hand-edited bootstrap.json can't slip an arbitrary
  // value past the type check.
  return (
    value === 'aix' ||
    value === 'android' ||
    value === 'cygwin' ||
    value === 'darwin' ||
    value === 'freebsd' ||
    value === 'haiku' ||
    value === 'linux' ||
    value === 'netbsd' ||
    value === 'openbsd' ||
    value === 'sunos' ||
    value === 'win32' ||
    value === 'web'
  )
}

function isRendererBootstrapSnapshot(value: unknown): value is RendererBootstrapSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RendererBootstrapSnapshot>
  return (
    isRendererRuntimeSnapshot(candidate.runtime) &&
    typeof candidate.homeDir === 'string' &&
    // `platform` is optional in the input shape so legacy hand-written
    // bootstrap scripts (and existing tests) keep working. The reader
    // path in renderer-bridge.ts fills in the 'web' default before
    // exposing the snapshot to the rest of the app.
    'initialI18n' in candidate &&
    'initialSettings' in candidate &&
    'initialServer' in candidate
  )
}

function normalizeServerUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value, window.location.href).toString()
  } catch {
    return null
  }
}

function normalizeServerClientId(value: string | null | undefined): string | null {
  if (!value) return null
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
}

export function readInjectedWebBootstrap(): RendererBootstrapSnapshot | null {
  try {
    if (isRendererBootstrapSnapshot(window.__GOBLIN_BOOTSTRAP__)) return window.__GOBLIN_BOOTSTRAP__
  } catch {}
  try {
    const raw = document.getElementById('goblin-bootstrap')?.textContent
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (isRendererBootstrapSnapshot(parsed)) return parsed
  } catch {}
  return null
}

export function readQueryBootstrap(createWebTerminalClientId: () => string): RendererBootstrapSnapshot | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const secret = params.get('goblinServerSecret')?.trim()
    const clientId = normalizeServerClientId(params.get('goblinServerClientId')?.trim()) ?? createWebTerminalClientId()
    if (!secret) return null
    const url = normalizeServerUrl(params.get('goblinServerUrl')?.trim() || window.location.origin)
    if (!url || !clientId) return null
    return {
      ...EMPTY_BOOTSTRAP,
      runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
      initialServer: { url, secret, clientId },
    }
  } catch {
    return null
  }
}

export function readWebBootstrap(createWebTerminalClientId: () => string): RendererBootstrapSnapshot {
  return readInjectedWebBootstrap() ?? readQueryBootstrap(createWebTerminalClientId) ?? EMPTY_BOOTSTRAP
}

export function emptyRendererBridgeBootstrap(): RendererBootstrapSnapshot {
  return EMPTY_BOOTSTRAP
}

export function normalizeRendererServerClientId(value: string | null | undefined): string | null {
  return normalizeServerClientId(value)
}
