import type {
  InitialServerSnapshot,
  InitialSettingsSnapshot,
  RendererBootstrapPayload,
  RendererBootstrapSnapshot,
  RendererNativeCapability,
  RendererPlatform,
  RendererRuntimeKind,
  RendererRuntimeSnapshot,
} from '#/shared/bootstrap.ts'
import type { I18nSnapshot } from '#/shared/api-types.ts'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

interface RendererBootstrapSeed {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  platform: RendererPlatform
  i18n: I18nSnapshot
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
        accessToken?: string
        clientId?: string
      }
    | null
    | undefined,
): InitialServerSnapshot | null {
  if (!server) return null
  return {
    url: server.url,
    ...(server.accessToken ? { accessToken: server.accessToken } : {}),
    ...(server.clientId ? { clientId: server.clientId } : {}),
  }
}

export function createRendererBootstrapPayload(seed: RendererBootstrapSeed): RendererBootstrapPayload {
  return {
    runtime: seed.runtime,
    homeDir: seed.homeDir,
    platform: seed.platform,
    i18n: seed.i18n,
    settings: seed.settings,
    server: seed.server,
  }
}

export function createRendererBootstrapSnapshot(seed: RendererBootstrapSeed): RendererBootstrapSnapshot {
  return {
    runtime: seed.runtime,
    homeDir: seed.homeDir,
    platform: seed.platform,
    initialI18n: seed.i18n,
    initialSettings: seed.settings,
    initialServer: seed.server,
  }
}
