export type RendererRuntimeKind = 'electron' | 'web'
export type RendererNativeCapability =
  | 'settings-ipc'
  | 'open-settings-window'
  | 'open-external-url'
  | 'open-directory-dialog'
  | 'consume-external-open-paths'
  | 'open-in-finder'
  | 'terminal-notifications'
  | 'terminal-badge'

export const RENDERER_BRIDGE_VERSION = 1
export const ELECTRON_RENDERER_CAPABILITIES = [
  'settings-ipc',
  'open-settings-window',
  'open-external-url',
  'open-directory-dialog',
  'consume-external-open-paths',
  'open-in-finder',
  'terminal-notifications',
  'terminal-badge',
] as const satisfies readonly RendererNativeCapability[]
export const WEB_RENDERER_CAPABILITIES = [] as const satisfies readonly RendererNativeCapability[]

export interface InitialServerSnapshot {
  url: string
  /**
   * Optional pre-rotation access token. The cookie path doesn't
   * need this — the embedded Electron main plants an http-only
   * cookie on the renderer's `webContents.session` before the
   * URL loads, and the web path exchanges the user-pasted token
   * for a cookie via `POST /api/login`. The field is kept on
   * the shape for `readQueryBootstrap` (QR-code login) which
   * can drop a token into the bootstrap before the first paint.
   */
  accessToken?: string
  /**
   * Renderer-generated client id. Surfaced through
   * `readQueryBootstrap` so a QR-code URL of the form
   * `?accessToken=…&goblinServerClientId=…` can hand the renderer
   * a deterministic id on first paint.
   */
  clientId?: string
}

export interface RendererRuntimeSnapshot {
  kind: RendererRuntimeKind
  bridgeVersion: number
  capabilities: readonly RendererNativeCapability[]
}

/**
 * Snapshot the renderer reads at module init. The server no longer
 * inlines these into HTML — the bootstrap is now a tiny payload
 * carrying only the runtime kind, the bridge protocol version, the
 * native capability set, and the optional QR-code server handoff.
 * Everything else (i18n, settings, host info) lives on dedicated
 * `/api/*` endpoints fetched by `useAppBootstrap.hydrate()` — the
 * server's HTML is an immutable static file.
 *
 *   - i18n:    `GET /api/i18n`   (public, see `#/web/stores/i18n.ts`)
 *   - settings:`GET /api/settings` (auth)
 *   - host:    `GET /api/host`   (public, see `#/web/stores/host-info.ts`)
 */
export interface RendererBootstrapSnapshot {
  runtime: RendererRuntimeSnapshot
  initialServer: InitialServerSnapshot | null
}
