import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import { createAccessTokenMiddleware } from '#/server/common/auth.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'
import { applyApiSecurityHeaders, buildCorsOriginPredicate } from '#/server/common/http-harden.ts'
import { accessLog } from '#/server/common/access-log.ts'
import { errorJson } from '#/server/common/responses.ts'
import { createAuthRoutes } from '#/server/routes/auth.ts'
import { createClipboardRoutes } from '#/server/routes/clipboard.ts'
import { createHealthRoutes } from '#/server/routes/health.ts'
import { createHostRoutes } from '#/server/routes/host.ts'
import { createRemoteRoutes } from '#/server/routes/remote.ts'
import { createRealtimeRoutes } from '#/server/routes/realtime.ts'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import { createSettingsRoutes } from '#/server/routes/settings.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import { createServerSettingsState } from '#/server/modules/settings-state.ts'
import { getServerI18nSnapshot } from '#/server/modules/i18n.ts'
import { MAX_PASTE_BATCH_BYTES } from '#/shared/clipboard-paste.ts'

export interface ServerAppOptions {
  version: string
  startedAt: number
  /**
   * Persistent access token shared with browser (cookie) and embedded
   * (header / `?t=` query) clients. Read from `dataDir/server-token`
   * by the server bootstrap (`#/server/bootstrap.ts`) — the same file
   * the Electron main reads, so the two processes see the same value.
   */
  accessToken: string
  terminalHost: ServerTerminalHost
  /**
   * The actual host the server is listening on. Used by the CORS
   * origin predicate to allow same-machine browsers. Defaults to
   * `127.0.0.1`, matching the default bind in
   * `#/server/bootstrap.ts`.
   */
  serverHost?: string
  /** The actual port the server is listening on. */
  serverPort?: number
}

// Cap request bodies on the data endpoints at 1 MiB. The largest real
// payload today is a settings patch (a few KB); 1 MiB leaves headroom
// for future growth (PR lists, diff hunks) while preventing a hostile
// client from pinning a worker with a multi-GB POST. Registered per
// sub-path (not globally on `/api/*`) so the clipboard route can opt
// in to a larger cap without widening the limit for everyone — Hono's
// `bodyLimit` reads Content-Length and short-circuits with `onError`
// before calling `next`, so a global rule cannot be overridden by a
// later, more permissive one. See `node_modules/hono/dist/middleware/body-limit/index.js`.
const API_BODY_LIMIT_BYTES = 1 * 1024 * 1024
// Tighter cap for the unauthenticated health endpoints — they don't
// take meaningful bodies, so a kilobyte is generous.
const HEALTH_BODY_LIMIT_BYTES = 1024

const WEB_DIST_DIR = path.resolve(import.meta.dirname, '../../dist/web')

const HASHED_WEB_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const ENTRY_WEB_ASSET_CACHE_CONTROL = 'no-store'

export function webStaticCacheControl(requestPath: string, response: Response): string {
  const contentType = response.headers.get('content-type') ?? ''
  const isHashedAsset =
    response.status === 200 && requestPath.startsWith('/assets/') && !contentType.toLowerCase().includes('text/html')
  return isHashedAsset ? HASHED_WEB_ASSET_CACHE_CONTROL : ENTRY_WEB_ASSET_CACHE_CONTROL
}

function applyWebStaticCacheHeaders(c: Context): void {
  c.header('Cache-Control', webStaticCacheControl(c.req.path, c.res))
}

function isServerRoutePath(requestPath: string): boolean {
  return (
    requestPath === '/api' || requestPath.startsWith('/api/') || requestPath === '/ws' || requestPath.startsWith('/ws/')
  )
}

export function createApp(options: ServerAppOptions): Hono {
  const settingsState = createServerSettingsState()
  const app = new Hono()
  app.use('*', accessLog())
  const serverHost = options.serverHost ?? '127.0.0.1'
  const serverPort = options.serverPort ?? 32100
  app.use(
    '/api/*',
    cors({
      origin: (origin: string, _c) => (buildCorsOriginPredicate(serverHost, serverPort)(origin) ? origin : ''),
      // `credentials: true` is required so the browser sends the
      // `goblin_access_token` cookie on cross-origin LAN requests.
      // Hono's `cors()` echoes the matched origin in
      // `Access-Control-Allow-Origin` (never `*`) and adds
      // `Vary: Origin` automatically when `credentials` is on.
      credentials: true,
      allowHeaders: ['Content-Type', ACCESS_TOKEN_HEADER],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  )
  app.use('/api/*', applyApiSecurityHeaders())
  // Body-limit is per sub-path rather than global on `/api/*` so the
  // clipboard route can use a larger cap (multipart blob uploads) while
  // every other route stays at the 1 MiB default and `/api/health/*`
  // uses an even tighter cap. Each `bodyLimit` registration is placed
  // *after* the auth middleware for the same sub-path: an unauthenticated
  // probe with a huge body should see 401 (not 413), so the server
  // doesn't measure the request and doesn't leak the presence of a size
  // limit before the secret check.
  app.use(
    '/api/health/*',
    bodyLimit({
      maxSize: HEALTH_BODY_LIMIT_BYTES,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  // Health check endpoints ( /api/health, /api/hi, etc.) are intentionally
  // left without auth middleware — they expose only non-sensitive informational
  // data (version, uptime). External access control is expected to be handled
  // by a gateway / reverse proxy when the server is bound to a LAN address.
  app.route(
    '/api',
    createHealthRoutes({ version: options.version, startedAt: options.startedAt, terminalHost: options.terminalHost }),
  )
  // Login / logout / whoami. `whoami` is gated by the same middleware
  // the data routes use, but `login` and `logout` are intentionally
  // unauthenticated — they're the only way to obtain / clear the
  // cookie, and the only thing they prove is that the caller knows
  // the token (or already has a valid cookie).
  app.route('/api', createAuthRoutes({ accessToken: options.accessToken }))
  // Body limit on the auth surface. The login route accepts an
  // unauthenticated JSON body (the only field is a 25-char base36
  // token — a few hundred bytes). Capping at 1 KiB stops a hostile
  // LAN client from POSTing a 100 MB body to /api/login and forcing
  // the server to allocate that much before the empty-token check
  // can return 400. `bodyLimit` short-circuits on Content-Length
  // before the JSON parser runs, so the cap is enforced without
  // needing to read the body.
  app.use(
    '/api/login',
    bodyLimit({
      maxSize: 1024,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  app.use(
    '/api/logout',
    bodyLimit({
      maxSize: 1024,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  app.use('/api/settings/*', createAccessTokenMiddleware(options.accessToken))
  app.use(
    '/api/settings/*',
    bodyLimit({
      maxSize: API_BODY_LIMIT_BYTES,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  app.use('/api/remote/*', createAccessTokenMiddleware(options.accessToken))
  app.use(
    '/api/remote/*',
    bodyLimit({
      maxSize: API_BODY_LIMIT_BYTES,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  app.use('/api/repo/*', createAccessTokenMiddleware(options.accessToken))
  app.use(
    '/api/repo/*',
    bodyLimit({
      maxSize: API_BODY_LIMIT_BYTES,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  app.use('/api/clipboard/*', createAccessTokenMiddleware(options.accessToken))
  // MAX_PASTE_BATCH_BYTES (12 MiB) is the *success* ceiling. The
  // failure case is also bounded but the timing depends on the
  // request's Transfer-Encoding: when `Content-Length` is set,
  // Hono rejects on the header value alone (see
  // node_modules/hono/dist/middleware/body-limit/index.js:18-21)
  // without reading any body bytes; when `Transfer-Encoding:
  // chunked` is set (or `Content-Length` is absent), Hono
  // accumulates bytes chunk-by-chunk and rejects once the running
  // total exceeds `maxSize`. A single oversized chunked request
  // can therefore pin ~`maxSize` of memory until the next GC.
  // For our threat model (auth required, body cap of 12 MiB, no
  // rate limiter) that's a bounded DoS surface, not an unbounded
  // one — but a future PR should add a per-IP rate limit on this
  // route to cap concurrent accumulation. The 413 envelope
  // already exists; rate-limiting is the missing piece.
  app.use(
    '/api/clipboard/*',
    bodyLimit({
      maxSize: MAX_PASTE_BATCH_BYTES,
      onError: (c) => errorJson(c, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  )
  app.route('/api/settings', createSettingsRoutes(settingsState))
  // i18n is mounted at a separate public path so the renderer can
  // fetch it before the user is authenticated. The token gate's
  // labels are translated by this endpoint; if it were under
  // `/api/settings/*` the gate would be stuck in raw-key land
  // until the user pasted a token. The handler is unauthenticated
  // by design — the dictionary is not sensitive.
  app.get('/api/i18n', async (c) => c.json(await getServerI18nSnapshot(c.req.header('accept-language'))))
  // Host info is public for the same reason i18n is: the renderer's
  // settings page mounts inside the token gate on first paint and
  // needs to know which OS-specific terminal entries to render
  // before the user is authenticated. The payload is non-sensitive
  // (home directory path + platform identifier).
  app.route('/api/host', createHostRoutes())
  app.route('/api/remote', createRemoteRoutes())
  app.route('/api/repo', createRepoRoutes())
  app.route('/api/clipboard', createClipboardRoutes())
  app.route('/ws', createRealtimeRoutes({ accessToken: options.accessToken, terminalHost: options.terminalHost }))

  // Periodic prune of clipboard temp dirs left by previous server
  // runs. The route factory's `pruneStaleClipboardTempDirs` call
  // already cleaned the current-run dir from any prior PIDs, but a
  // long-lived server (e.g. LAN deployment) would otherwise
  // accumulate files until next restart. The cap is bounded by
  // per-file size, not file count, so this is housekeeping, not
  // security. Coarse cadence (1 h) because the cost is trivial.
  // The `unref` lets the process exit naturally — without it, the
  // interval keeps the event loop alive.
  const periodic = setInterval(
    () => {
      void import('#/server/modules/clipboard-write-paths.ts')
        .then((m) => Promise.all([m.pruneStaleClipboardTempDirs(), m.pruneExpiredClipboardTempFiles()]))
        .catch((err) => console.warn('[clipboard] periodic prune failed', err))
    },
    60 * 60 * 1000,
  )
  if (typeof periodic.unref === 'function') periodic.unref()

  // The built web bundle is served as plain static files. The
  // renderer pulls its bootstrap (i18n, settings, server URL) from
  // `/api/settings/*` and the access token either from the Electron
  // preload's IPC or the `/api/login` cookie — the server no longer
  // rewrites `dist/web/index.html`. Skipping the middleware on a
  // fresh checkout (e.g. `bun run test` without `bun run build`)
  // keeps Hono from logging `serveStatic: root path ... is not
  // found` on every server boot.
  if (existsSync(WEB_DIST_DIR)) {
    const webIndexHtmlPath = path.join(WEB_DIST_DIR, 'index.html')
    app.use('*', async (c, next) => {
      await next()
      if (!isServerRoutePath(c.req.path)) applyWebStaticCacheHeaders(c)
    })
    app.use('/*', serveStatic({ root: WEB_DIST_DIR }))
    // SPA fallback: deep links that don't match a real static file
    // (e.g. `/repos/abc123/changes`) get the raw `index.html` so
    // React Router can take over. `/api/*` and `/ws/*` requests
    // fall through to the JSON `notFound` handler below.
    app.get('*', async (c) => {
      if (isServerRoutePath(c.req.path)) {
        return errorJson(c, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`)
      }
      try {
        const { readFile } = await import('node:fs/promises')
        return c.html(await readFile(webIndexHtmlPath, 'utf8'))
      } catch {
        return c.text('Not Found', 404)
      }
    })
  }
  return app
}
