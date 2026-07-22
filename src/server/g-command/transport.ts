import * as v from 'valibot'
import type { GoblinCommandTransport } from '#/server/g-command/context.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'

const ErrorResponseSchema = v.union([
  v.strictObject({ message: v.string() }),
  v.strictObject({ ok: v.literal(false), code: v.string(), message: v.string() }),
])

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
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = globalThis.fetch,
): GoblinCommandTransport {
  const token = readAccessToken(env)
  if (!token) {
    throw new TransportError('GOBLIN_SERVER_ACCESS_TOKEN is not set')
  }
  const baseUrl = readServerUrl(env)
  const headers = { [ACCESS_TOKEN_HEADER]: token, 'content-type': 'application/json' }

  async function postJson<T>(pathname: string, body: unknown, decode: (value: unknown) => T): Promise<T> {
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
        const parsed = v.safeParse(ErrorResponseSchema, await response.json())
        if (parsed.success) detail = `: ${parsed.output.message}`
      } catch {}
      throw new TransportError(`request failed (${response.status})${detail}`)
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new TransportError('server returned invalid JSON')
    }
    try {
      return decode(payload)
    } catch {
      throw new TransportError('server returned an invalid response')
    }
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
