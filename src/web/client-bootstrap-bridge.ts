import type { ClientBootstrapSnapshot, ClientRuntimeSnapshot } from '#/shared/bootstrap.ts'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
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
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ClientRuntimeSnapshot>
  return (
    (candidate.kind === 'electron' || candidate.kind === 'web') &&
    typeof candidate.bridgeVersion === 'number' &&
    Array.isArray(candidate.capabilities) &&
    candidate.capabilities.every((capability) => typeof capability === 'string')
  )
}

function isClientBootstrapSnapshot(value: unknown): value is ClientBootstrapSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ClientBootstrapSnapshot>
  // `runtime` is optional in the validation: the bridge layer
  // detects Electron vs web by the presence of `window.goblinNative`,
  // not by `bootstrap.runtime.kind`. Tests that previously had the
  // runtime carried via the preload (and never in the bootstrap)
  // keep working without having to fill in both surfaces. The
  // `getBootstrap()` reader in `client-bridge.ts` substitutes a
  // sensible default when the field is missing.
  return (candidate.runtime === undefined || isClientRuntimeSnapshot(candidate.runtime)) && 'initialServer' in candidate
}

function normalizeServerUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value, window.location.href).toString()
  } catch {
    return null
  }
}

function fillRuntimeDefaults(snapshot: ClientBootstrapSnapshot): ClientBootstrapSnapshot {
  if (snapshot.runtime) return snapshot
  // The `runtime` field is now optional in the input; substitute a
  // web default when the source omitted it. The bridge layer's
  // Electron detection does not depend on this field — see
  // `getClientBridge` in `#/web/client-bridge.ts`.
  return { ...snapshot, runtime: { ...EMPTY_BOOTSTRAP.runtime } }
}

export function readInjectedWebBootstrap(): ClientBootstrapSnapshot | null {
  try {
    if (isClientBootstrapSnapshot(window.__GOBLIN_BOOTSTRAP__)) return fillRuntimeDefaults(window.__GOBLIN_BOOTSTRAP__)
  } catch {}
  try {
    const raw = document.getElementById('goblin-bootstrap')?.textContent
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (isClientBootstrapSnapshot(parsed)) return fillRuntimeDefaults(parsed)
  } catch {}
  return null
}

export function readQueryBootstrap(): ClientBootstrapSnapshot | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const accessToken = params.get(ACCESS_TOKEN_URL_PARAM)?.trim()
    if (!accessToken) return null
    const url = normalizeServerUrl(params.get('goblinServerUrl')?.trim() || window.location.origin)
    if (!url) return null
    return {
      ...EMPTY_BOOTSTRAP,
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: { url, accessToken },
    }
  } catch {
    return null
  }
}

export function readWebBootstrap(): ClientBootstrapSnapshot {
  return readInjectedWebBootstrap() ?? readQueryBootstrap() ?? EMPTY_BOOTSTRAP
}

export function emptyBootstrapSnapshot(): ClientBootstrapSnapshot {
  return EMPTY_BOOTSTRAP
}
