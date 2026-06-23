import type { GoblinCommandTransport } from '#/server/g-command/context.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'

// HTTP transport that talks to the parent Goblin server over
// `127.0.0.1:<port>` (or wherever `$GOBLIN_SERVER_URL` points).
// Connection details come from the PTY environment that's already
// in `process.env` — see `#/server/terminal/g-command.ts` for the
// env contract.

function readServerUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.GOBLIN_SERVER_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const port = env.GOBLIN_SERVER_PORT?.trim() || '32100'
  let host = env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
  if (host === '0.0.0.0') host = '127.0.0.1'
  if (host === '::') host = '[::1]'
  else if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  return `http://${host}:${port}`
}

function readAccessToken(env: NodeJS.ProcessEnv): string | null {
  return env.GOBLIN_SERVER_ACCESS_TOKEN?.trim() || null
}

export function createHttpTransport(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): GoblinCommandTransport {
  const token = readAccessToken(env)
  if (!token) {
    throw new TransportError('GOBLIN_SERVER_ACCESS_TOKEN is not set')
  }
  const baseUrl = readServerUrl(env)
  const headers = { [ACCESS_TOKEN_HEADER]: token }

  async function postJson<T>(pathname: string, body: unknown): Promise<T> {
    const url = new URL(pathname, baseUrl)
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new TransportError(err instanceof Error ? err.message : String(err))
    }
    if (!response.ok) {
      let detail = ''
      try {
        const payload = (await response.json()) as { message?: string }
        if (payload && typeof payload.message === 'string') detail = `: ${payload.message}`
      } catch {}
      throw new TransportError(`request failed (${response.status})${detail}`)
    }
    return (await response.json()) as T
  }

  return { postJson }
}

export class TransportError extends Error {
  // No CLI-level prefix here — every `g` output site prefixes with
  // `g:` itself, and putting it in two places produced the visible
  // double-prefix `g: g: <reason>` bug. Keep this error message as
  // the raw transport reason.
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}
