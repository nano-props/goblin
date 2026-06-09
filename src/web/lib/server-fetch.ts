import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'

interface EmbeddedServerConfig {
  url: string
  secret: string
}

function getEmbeddedServer(): EmbeddedServerConfig | null {
  const server = getInitialBootstrap().initialServer
  if (!server?.url || !server?.secret) return null
  return server
}

function requireEmbeddedServer(): EmbeddedServerConfig {
  const server = getEmbeddedServer()
  if (!server) throw new Error('Embedded server unavailable')
  return server
}

export async function fetchServerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const server = requireEmbeddedServer()
  const response = await fetch(new URL(path, resolveApiBaseUrl(server.url)).toString(), {
    ...init,
    headers: {
      'x-goblin-internal-secret': server.secret,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`Server request failed: HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function postServerJson<TInput extends object, TOutput>(
  path: string,
  input: TInput,
  options?: { signal?: AbortSignal },
): Promise<TOutput> {
  return await fetchServerJson<TOutput>(path, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}
