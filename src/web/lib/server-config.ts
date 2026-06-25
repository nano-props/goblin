import { getInitialBootstrap } from '#/web/bootstrap.ts'

export interface ClientServerConfig {
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
// same-origin web clients do not: they are already loaded from the server
// origin and authenticate with the cookie the server planted.
export function resolveClientServerConfig(): ClientServerConfig | null {
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

export function hasClientServerConfig(): boolean {
  return resolveClientServerConfig() !== null
}

export function requireClientServerConfig(): ClientServerConfig {
  const server = resolveClientServerConfig()
  if (!server) throw new Error('Embedded server unavailable')
  return server
}
