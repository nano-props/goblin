import type { ClientBootstrapSnapshot, ClientRuntimeSnapshot } from '#/shared/bootstrap.ts'
import { CLIENT_BRIDGE_VERSION, ELECTRON_CLIENT_CAPABILITIES, WEB_CLIENT_CAPABILITIES } from '#/shared/bootstrap.ts'
import { ACCESS_TOKEN_URL_PARAM } from '#/shared/access-token.ts'

/**
 * Bootstrap for a web-hosted client with no host OS. The bootstrap
 * is now a tiny 3-field payload: `runtime` (kind, bridge version,
 * capabilities), `initialServer` (only populated for QR-code
 * logins), and nothing else. Host info (homeDir / platform) moved
 * to the public `/api/host` endpoint and lives in
 * `#/web/stores/host-info.ts`; i18n lives in `#/web/stores/i18n.ts`.
 */
const EMPTY_BOOTSTRAP: ClientBootstrapSnapshot = {
  runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
  initialServer: null,
}

function isClientRuntimeSnapshot(value: unknown): value is ClientRuntimeSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ['kind', 'bridgeVersion', 'capabilities'])) return false
  const candidate = value as Partial<ClientRuntimeSnapshot>
  if (candidate.bridgeVersion !== CLIENT_BRIDGE_VERSION || !Array.isArray(candidate.capabilities)) return false
  const expected =
    candidate.kind === 'electron'
      ? ELECTRON_CLIENT_CAPABILITIES
      : candidate.kind === 'web'
        ? WEB_CLIENT_CAPABILITIES
        : null
  return !!expected && arraysEqual(candidate.capabilities, expected)
}

function isClientBootstrapSnapshot(value: unknown): value is ClientBootstrapSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ['runtime', 'initialServer'])) return false
  const candidate = value as Partial<ClientBootstrapSnapshot>
  return isClientRuntimeSnapshot(candidate.runtime) && isInitialServerSnapshot(candidate.initialServer)
}

function isInitialServerSnapshot(value: unknown): boolean {
  if (value === null) return true
  if (!isRecord(value) || !hasOnlyKeys(value, ['url', 'accessToken']) || !hasExactRequiredKeys(value, ['url'])) {
    return false
  }
  if (typeof value.url !== 'string' || (value.accessToken !== undefined && typeof value.accessToken !== 'string')) {
    return false
  }
  try {
    const protocol = new URL(value.url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function hasExactRequiredKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key))
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeServerUrl(value: string): string {
  try {
    return new URL(value, window.location.href).toString()
  } catch (error) {
    throw new Error('Invalid client bootstrap server URL', { cause: error })
  }
}

export function readInjectedWebBootstrap(): ClientBootstrapSnapshot | null {
  if (typeof window === 'undefined') return null
  const injected = window.__GOBLIN_BOOTSTRAP__
  if (injected !== undefined) {
    if (!isClientBootstrapSnapshot(injected)) throw new Error('Invalid injected client bootstrap')
    return injected
  }
  if (typeof document === 'undefined') return null
  const element = document.getElementById('goblin-bootstrap')
  if (!element) return null
  const raw = element.textContent
  if (!raw) throw new Error('Empty client bootstrap element')
  const parsed: unknown = JSON.parse(raw)
  if (!isClientBootstrapSnapshot(parsed)) throw new Error('Invalid client bootstrap element')
  return parsed
}

export function readQueryBootstrap(): ClientBootstrapSnapshot | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const accessToken = params.get(ACCESS_TOKEN_URL_PARAM)?.trim()
  if (!accessToken) return null
  const url = normalizeServerUrl(params.get('goblinServerUrl')?.trim() || window.location.origin)
  return {
    ...EMPTY_BOOTSTRAP,
    runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
    initialServer: { url, accessToken },
  }
}

export function readWebBootstrap(): ClientBootstrapSnapshot {
  return readInjectedWebBootstrap() ?? readQueryBootstrap() ?? EMPTY_BOOTSTRAP
}

export function emptyBootstrapSnapshot(): ClientBootstrapSnapshot {
  return EMPTY_BOOTSTRAP
}
