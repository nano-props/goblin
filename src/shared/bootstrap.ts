export type ClientRuntimeKind = 'electron' | 'web'
export type ClientNativeCapability =
  | 'settings-ipc'
  | 'open-settings-window'
  | 'open-external-url'
  | 'open-directory-dialog'
  | 'consume-external-open-paths'
  | 'open-in-finder'
  | 'terminal-notifications'
  | 'terminal-badge'

export const CLIENT_BRIDGE_VERSION = 1
export const ELECTRON_CLIENT_CAPABILITIES = [
  'settings-ipc',
  'open-settings-window',
  'open-external-url',
  'open-directory-dialog',
  'consume-external-open-paths',
  'open-in-finder',
  'terminal-notifications',
  'terminal-badge',
] as const satisfies readonly ClientNativeCapability[]
export const WEB_CLIENT_CAPABILITIES = [] as const satisfies readonly ClientNativeCapability[]

export interface InitialServerSnapshot {
  url: string
  /**
   * Optional pre-rotation access token. The cookie path doesn't
   * need this — the embedded Electron main plants an http-only
   * cookie on the client's `webContents.session` before the
   * URL loads, and the web path exchanges the user-pasted token
   * for a cookie via `POST /api/login`. The field is kept on
   * the shape for `readQueryBootstrap` (QR-code login) which
   * can drop a token into the bootstrap before the first paint.
   */
  accessToken?: string
  /**
   * Client-generated client id. Surfaced through
   * `readQueryBootstrap` so a QR-code URL of the form
   * `?accessToken=…&goblinServerClientId=…` can hand the client
   * a deterministic id on first paint.
   */
  clientId?: string
}

export interface ClientRuntimeSnapshot {
  kind: ClientRuntimeKind
  bridgeVersion: number
  capabilities: readonly ClientNativeCapability[]
}

/**
 * Snapshot the client reads at module init. The server no longer
 * inlines these into HTML — the bootstrap is now a tiny payload
 * carrying only the runtime kind, the bridge protocol version, the
 * native capability set, and the optional QR-code server handoff.
 * Everything else (i18n, settings, host info) lives on dedicated
 * `/api/*` endpoints. The client hydrates i18n before mounting
 * the normal React tree, then the app bootstrap hooks hydrate the
 * remaining runtime state. The server's HTML is an immutable static
 * file.
 *
 *   - i18n:    `GET /api/i18n`   (public, see `#/web/main.tsx`)
 *   - settings:`GET /api/settings` (auth)
 *   - host:    `GET /api/host`   (public, see `#/web/stores/host-info.ts`)
 */
export interface ClientBootstrapSnapshot {
  runtime: ClientRuntimeSnapshot
  initialServer: InitialServerSnapshot | null
}
