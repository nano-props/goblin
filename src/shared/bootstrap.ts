export const CLIENT_BRIDGE_VERSION = 1
export const WEB_CLIENT_CAPABILITIES = [] as const

export interface InitialServerSnapshot {
  url: string
  /** Optional token from a QR/login handoff; ordinary sessions use an HttpOnly auth cookie. */
  accessToken?: string
}

export interface ClientRuntimeSnapshot {
  kind: 'web'
  bridgeVersion: number
  capabilities: readonly never[]
}

/**
 * Snapshot the client reads at module init. The server no longer
 * inlines these into HTML — the bootstrap is now a tiny payload
 * carrying only the runtime kind, the bridge protocol version, the
 * empty browser capability list, and the optional QR-code server handoff.
 * Everything else (i18n, settings, host info) lives behind dedicated
 * server procedures. The client hydrates i18n before mounting
 * the normal Vue tree, then the app bootstrap composables hydrate the
 * remaining runtime state. The server's HTML is an immutable static
 * file.
 */
export interface ClientBootstrapSnapshot {
  runtime: ClientRuntimeSnapshot
  initialServer: InitialServerSnapshot | null
}
