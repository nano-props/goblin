import type {
  InitialI18nSnapshot,
  InitialServerSnapshot,
  InitialSettingsSnapshot,
  RendererBootstrapPayload,
  RendererBootstrapSnapshot,
  RendererNativeCapability,
  RendererRuntimeKind,
  RendererRuntimeSnapshot,
} from '#/shared/bootstrap.ts'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

interface RendererBootstrapSeed {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  i18n: InitialI18nSnapshot
  settings: InitialSettingsSnapshot
  server: InitialServerSnapshot | null
}

export function createRendererRuntimeSnapshot(
  kind: RendererRuntimeKind,
  capabilities: readonly RendererNativeCapability[],
): RendererRuntimeSnapshot {
  return {
    kind,
    bridgeVersion: RENDERER_BRIDGE_VERSION,
    capabilities: [...capabilities],
  }
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
    runtime: seed.runtime,
    homeDir: seed.homeDir,
    i18n: seed.i18n,
    settings: seed.settings,
    server: seed.server,
  }
}

export function createRendererBootstrapSnapshot(seed: RendererBootstrapSeed): RendererBootstrapSnapshot {
  return {
    runtime: seed.runtime,
    homeDir: seed.homeDir,
    initialI18n: seed.i18n,
    initialSettings: seed.settings,
    initialServer: seed.server,
  }
}
