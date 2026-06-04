import type { RendererBootstrapSnapshot, RendererRuntimeSnapshot } from '#/shared/bootstrap.ts'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

const EMPTY_BOOTSTRAP: RendererBootstrapSnapshot = {
  runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
  homeDir: '',
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

function isRendererBootstrapSnapshot(value: unknown): value is RendererBootstrapSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RendererBootstrapSnapshot>
  return (
    isRendererRuntimeSnapshot(candidate.runtime) &&
    typeof candidate.homeDir === 'string' &&
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
