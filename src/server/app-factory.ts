import { access, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { createInternalAuthMiddleware } from '#/server/common/auth.ts'
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
}

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
  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'x-goblin-internal-secret'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  )
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
  app.get('*', async (c) => {
    try {
      return c.html(
        await renderRendererIndexHtml(c.req.url, options.internalSecret, c.req.header('accept-language') ?? null),
      )
    } catch {
      return c.text('Not Found', 404)
    }
  })
  return app
}
