import { getInitialBootstrap } from '#/web/bootstrap.ts'

export interface RendererServerConfig {
  url: string
  accessToken: string
}

function sameOriginServerUrl(): string | null {
  if (typeof window === 'undefined') return null
  const location = window.location
  if (!location?.origin) return null
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null
  return location.origin
}

// QR-code/bootstrap handoffs carry an explicit server URL. Embedded and
// same-origin web renderers do not: they are already loaded from the server
// origin and authenticate with the cookie the server planted.
export function resolveRendererServerConfig(): RendererServerConfig | null {
  const fromBootstrap = getInitialBootstrap().initialServer
  if (fromBootstrap?.url) {
    return { url: fromBootstrap.url, accessToken: fromBootstrap.accessToken ?? '' }
  }
  const sameOriginUrl = sameOriginServerUrl()
  if (sameOriginUrl) {
    return { url: sameOriginUrl, accessToken: '' }
  }
  return null
}

export function hasRendererServerConfig(): boolean {
  return resolveRendererServerConfig() !== null
}

export function requireRendererServerConfig(): RendererServerConfig {
  const server = resolveRendererServerConfig()
  if (!server) throw new Error('Embedded server unavailable')
  return server
}
