import { access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import { createInternalAuthMiddleware } from '#/server/common/auth.ts'
import { applyApiSecurityHeaders, buildCorsOriginPredicate } from '#/server/common/http-harden.ts'
import { accessLog } from '#/server/common/access-log.ts'
import { errorJson } from '#/server/common/responses.ts'
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

export interface ServerAppOptions {
  version: string
  startedAt: number
  internalSecret: string
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
// client from pinning a worker with a multi-GB POST.
const API_BODY_LIMIT_BYTES = 1 * 1024 * 1024

const WEB_DIST_DIR = path.resolve(import.meta.dirname, '../../dist/web')
const WEB_INDEX_HTML = path.join(WEB_DIST_DIR, 'index.html')
function deriveServerClientId(secret: string): string {
  return `client_${createHash('sha256').update(secret).digest('hex').slice(0, 32)}`
}

function buildWebBootstrap(
  requestUrl: string,
  internalSecret: string,
  acceptLanguageHeader: string | null,
  langPref: LangPref,
  settings: Awaited<ReturnType<typeof getServerSettingsPrefs>>,
): RendererBootstrapSnapshot {
  const origin = new URL(requestUrl).origin
  return createRendererBootstrapSnapshot({
    runtime: createRendererRuntimeSnapshot('web', WEB_RENDERER_CAPABILITIES),
    homeDir: os.homedir(),
    platform: 'web',
    i18n: resolveI18nSnapshot(langPref, acceptLanguageHeader),
    settings: initialSettingsFromSnapshot({
      ...settings,
      globalShortcutRegistered: false,
    }),
    server: toInitialServerSnapshot({
      url: `${origin}/`,
      secret: internalSecret,
      clientId: deriveServerClientId(internalSecret),
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
  internalSecret: string,
  acceptLanguageHeader: string | null,
): Promise<string> {
  await access(WEB_INDEX_HTML)
  const settings = await getServerSettingsPrefs()
  const bootstrap = buildWebBootstrap(requestUrl, internalSecret, acceptLanguageHeader, settings.lang, settings)
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
      allowHeaders: ['Content-Type', 'x-goblin-internal-secret'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
    }),
  )
  app.use('/api/*', applyApiSecurityHeaders())
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: API_BODY_LIMIT_BYTES,
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
  app.use('/api/settings/*', createInternalAuthMiddleware(options.internalSecret))
  app.use('/api/remote/*', createInternalAuthMiddleware(options.internalSecret))
  app.use('/api/repo/*', createInternalAuthMiddleware(options.internalSecret))
  app.route('/api/settings', createSettingsRoutes(settingsState))
  app.route('/api/remote', createRemoteRoutes())
  app.route('/api/repo', createRepoRoutes())
  app.route('/ws', createRealtimeRoutes({ internalSecret: options.internalSecret, terminalHost: options.terminalHost }))

  // Explicit SPA routes — must be before serveStatic so the
  // bootstrap script is injected into the HTML response instead
  // of serving the raw dist/web/index.html file.
  app.get('/', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, options.internalSecret, c.req.header('accept-language') ?? null),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.get('/index.html', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, options.internalSecret, c.req.header('accept-language') ?? null),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.get('/settings', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, options.internalSecret, c.req.header('accept-language') ?? null),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.get('/settings/*', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, options.internalSecret, c.req.header('accept-language') ?? null),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.use('/*', serveStatic({ root: WEB_DIST_DIR }))
  // Catch-all SPA fallback: deep-links that didn't match a static
  // file (e.g. /repos/abc123) get the rendered index.html so the
  // React app can take over routing. /api/* and /ws/* requests
  // that reach here fall through to the JSON notFound handler.
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/ws/')) return next()
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, options.internalSecret, c.req.header('accept-language') ?? null),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  app.notFound((c) => errorJson(c, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`))
  return app
}
