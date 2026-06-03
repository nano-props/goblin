import type {
  InitialI18nSnapshot,
  InitialServerSnapshot,
  InitialSettingsSnapshot,
  RendererBootstrapPayload,
  RendererBootstrapSnapshot,
} from '#/shared/bootstrap.ts'

interface RendererBootstrapSeed {
  homeDir: string
  i18n: InitialI18nSnapshot
  settings: InitialSettingsSnapshot
  server: InitialServerSnapshot | null
}

export function toInitialServerSnapshot(
  server:
    | {
        url: string
        secret: string
        clientId?: string
      }
    | null
    | undefined,
): InitialServerSnapshot | null {
  return server ? { url: server.url, secret: server.secret, ...(server.clientId ? { clientId: server.clientId } : {}) } : null
}

export function createRendererBootstrapPayload(seed: RendererBootstrapSeed): RendererBootstrapPayload {
  return {
    homeDir: seed.homeDir,
    i18n: seed.i18n,
    settings: seed.settings,
    server: seed.server,
  }
}

export function createRendererBootstrapSnapshot(seed: RendererBootstrapSeed): RendererBootstrapSnapshot {
  return {
    homeDir: seed.homeDir,
    initialI18n: seed.i18n,
    initialSettings: seed.settings,
    initialServer: seed.server,
  }
}
