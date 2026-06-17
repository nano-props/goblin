import { access, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import { ACCESS_TOKEN_HEADER, createAccessTokenMiddleware } from '#/server/common/auth.ts'
import { applyApiSecurityHeaders, buildCorsOriginPredicate } from '#/server/common/http-harden.ts'
import { accessLog } from '#/server/common/access-log.ts'
import { errorJson } from '#/server/common/responses.ts'
import { createAuthRoutes } from '#/server/routes/auth.ts'
import { createClipboardRoutes } from '#/server/routes/clipboard.ts'
import { createHealthRoutes } from '#/server/routes/health.ts'
import { createRemoteRoutes } from '#/server/routes/remote.ts'
import { createRealtimeRoutes } from '#/server/routes/realtime.ts'
import { createRepoRoutes } from '#/server/routes/repo.ts'
import { createSettingsRoutes } from '#/server/routes/settings.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import { createServerSettingsState } from '#/server/modules/settings-state.ts'
import { createRendererBootstrapSnapshot, toInitialServerSnapshot } from '#/shared/bootstrap-builders.ts'
import { createRendererRuntimeSnapshot } from '#/shared/bootstrap-builders.ts'
import { WEB_RENDERER_CAPABILITIES } from '#/shared/bootstrap.ts'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import { initialSettingsFromSnapshot } from '#/shared/settings-defaults.ts'
import type { LangPref } from '#/shared/api-types.ts'
import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
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
const WEB_INDEX_HTML = path.join(WEB_DIST_DIR, 'index.html')

/**
 * Decide whether to inline the access token in the HTML bootstrap.
 *
 * - `GOBLIN_EMBEDDED_RUNTIME=1` is set by the Electron main when it
 *   spawns the server; the embedded renderer is the primary HTML
 *   consumer, so the bootstrap carries the token directly.
 * - `GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN=1` is set by `bun run dev`
 *   so the Vite-served browser (which can't share cookies with the
 *   server on a different origin) can attach the token as a header.
 *
 * Standalone `serve.sh` / `scripts/start-server.ts` sets neither,
 * producing a token-less bootstrap that drives the renderer through
 * the cookie + `/api/login` gate.
 */
function shouldInlineAccessTokenInBootstrap(): boolean {
  return (
    process.env.GOBLIN_EMBEDDED_RUNTIME === '1' ||
    process.env.GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN === '1'
  )
}

/**
 * Read `homeDir` and `platform` from the spawn env (set by the
 * Electron main in `#/main/server-manager.ts`), falling back to
 * `os.homedir()` / `os.platform()` when the server is started outside
 * the Electron host (e.g. `bun run dev`, `scripts/start-server.ts`).
 * The fallback is benign — the values just go into the renderer
 * bootstrap for display purposes.
 */
function resolveBootstrapHostInfo(): { homeDir: string; platform: string } {
  const homeDir = process.env.GOBLIN_HOME_DIR?.trim() || os.homedir()
  const platform = process.env.GOBLIN_PLATFORM?.trim() || os.platform()
  return { homeDir, platform }
}

function buildWebBootstrap(
  requestUrl: string,
  acceptLanguageHeader: string | null,
  langPref: LangPref,
  settings: Awaited<ReturnType<typeof getServerSettingsPrefs>>,
  options: { accessToken: string; includeAccessToken: boolean },
): RendererBootstrapSnapshot {
  const origin = new URL(requestUrl).origin
  const { homeDir, platform } = resolveBootstrapHostInfo()
  return createRendererBootstrapSnapshot({
    runtime: createRendererRuntimeSnapshot('web', WEB_RENDERER_CAPABILITIES),
    homeDir,
    platform: platform as NodeJS.Platform,
    i18n: resolveI18nSnapshot(langPref, acceptLanguageHeader),
    settings: initialSettingsFromSnapshot({
      ...settings,
      globalShortcutRegistered: false,
    }),
    server: toInitialServerSnapshot({
      url: `${origin}/`,
      ...(options.includeAccessToken ? { accessToken: options.accessToken } : {}),
    }),
  })
}

function escapeBootstrapJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function injectBootstrapIntoHtml(indexHtml: string, bootstrap: RendererBootstrapSnapshot): string {
  const baseHref = bootstrap.initialServer ? `${new URL(bootstrap.initialServer.url).origin}/` : '/'
  const bootstrapScript = `<script id="goblin-bootstrap" type="application/json">${escapeBootstrapJson(bootstrap)}</script>`
  return indexHtml
    .replace('<html lang="en">', `<html lang="${bootstrap.initialI18n?.lang ?? 'en'}">`)
    .replace('<head>', `<head>\n    <base href="${baseHref}">`)
    .replace(
      '<script type="module" src="./boot.js"></script>',
      `${bootstrapScript}\n    <script type="module" src="./boot.js"></script>`,
    )
}

async function renderRendererIndexHtml(
  requestUrl: string,
  acceptLanguageHeader: string | null,
  accessToken: string,
): Promise<string> {
  await access(WEB_INDEX_HTML)
  const settings = await getServerSettingsPrefs()
  const bootstrap = buildWebBootstrap(
    requestUrl,
    acceptLanguageHeader,
    settings.lang,
    settings,
    { accessToken, includeAccessToken: shouldInlineAccessTokenInBootstrap() },
  )
  return injectBootstrapIntoHtml(await readFile(WEB_INDEX_HTML, 'utf8'), bootstrap)
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
      void import('#/server/modules/clipboard-write-paths.ts').then((m) =>
        m.pruneStaleClipboardTempDirs(),
      )
    },
    60 * 60 * 1000,
  )
  if (typeof periodic.unref === 'function') periodic.unref()

  // Explicit SPA routes — must be before serveStatic so the
  // bootstrap script is injected into the HTML response instead
  // of serving the raw dist/web/index.html file. The token-in-bootstrap
  // decision lives in `shouldInlineAccessTokenInBootstrap()` and only
  // resolves to "true" for the embedded renderer (`GOBLIN_EMBEDDED_RUNTIME=1`)
  // and `bun run dev` (`GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN=1`).
  app.get('/', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, c.req.header('accept-language') ?? null, options.accessToken),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.get('/index.html', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, c.req.header('accept-language') ?? null, options.accessToken),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.get('/settings', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, c.req.header('accept-language') ?? null, options.accessToken),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.get('/settings/*', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, c.req.header('accept-language') ?? null, options.accessToken),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  // Only register the static-file middleware when the built web bundle
  // exists. Skipping it on a fresh checkout (e.g. `bun run test` without
  // `bun run build`) keeps Hono from logging `serveStatic: root path ...
  // is not found` on every server boot.
  if (existsSync(WEB_DIST_DIR)) {
    app.use('/*', serveStatic({ root: WEB_DIST_DIR }))
  }
  // Catch-all SPA fallback: deep-links that didn't match a static
  // file (e.g. /repos/abc123) get the rendered index.html so the
  // React app can take over routing. /api/* and /ws/* requests
  // that reach here fall through to the JSON notFound handler.
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/ws/')) return next()
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, c.req.header('accept-language') ?? null, options.accessToken),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.notFound((c) => errorJson(c, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`))
  return app
}
