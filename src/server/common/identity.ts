import crypto from 'node:crypto'
import type { Context } from 'hono'

/**
 * Identity model
 * --------------
 * `clientId` is a per-tab routing identifier minted by the renderer
 * (sessionStorage / Electron IPC). It keys the realtime broker and the
 * WebSocket query param. It is NOT a stable identity — two browsers
 * on the same machine get two different `clientId`s.
 *
 * `userId` is a per-token identity derived deterministically from
 * the access token by `deriveUserId()`. The server uses `userId`
 * to partition the in-memory session store, so a single access token
 * shared across browsers (Electron desktop + Chrome on the same host)
 * sees the same terminals. `clientId` keeps doing per-tab fanout at
 * the broker layer.
 *
 * Same access token  => same `userId`  => shared sessions
 * Different clientIds => different broker sockets => independent WS
 * lifecycles (close one tab, the other keeps streaming).
 */

const cache = new Map<string, string>()
// Defensive cap: in practice the cache holds exactly one entry per
// access token per server lifetime. The cap exists so a future
// change that passes a non-token value (e.g. session id) cannot
// balloon the cache. We do NOT use an LRU — eviction is full clear,
// which is fine because the cap is small and derive is cheap.
const CACHE_CAP = 1024

/**
 * Derive a stable `userId` from an access token. Two clients with
 * the same token always see the same `userId`. The `owner_` prefix
 * keeps log lines and Map keys unambiguous against the `term_…`,
 * `client_…`, and `web_…` namespaces used elsewhere in the
 * terminal code.
 *
 * 128 bits of entropy is collision-safe across realistic installs
 * (the birthday bound at 2^64 is well above any single-server
 * session count). We hash the literal token bytes; rotation produces
 * a different `userId`, so old browser tabs on the old token still
 * see the old sessions after a token rotate.
 */
export function deriveUserId(token: string): string {
  const cached = cache.get(token)
  if (cached) return cached
  if (cache.size >= CACHE_CAP) cache.clear()
  const hex = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)
  const id = `user_${hex}`
  cache.set(token, id)
  return id
}

/**
 * Read the `userId` previously set by `createAccessTokenMiddleware`.
 * Returns `undefined` if the request never went through the auth
 * middleware (e.g. a misuse where auth was skipped) — callers should
 * treat that as "unauthorized" rather than an empty string, because
 * the empty string is itself a valid (if useless) userId and would
 * silently merge unrelated requests.
 */
export function userIdFromContext(c: Context): string | undefined {
  return c.get('userId') as string | undefined
}
