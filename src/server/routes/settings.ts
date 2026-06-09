import { Hono } from 'hono'
import { getServerExternalAppsSnapshot } from '#/server/modules/external-apps.ts'
import { getServerGitHubCliState } from '#/server/modules/github-cli.ts'
import { getServerI18nSnapshot } from '#/server/modules/i18n.ts'
import { getSettingsSnapshot } from '#/server/modules/settings.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import {
  applyServerFetchIntervalWrite,
  applyServerGlobalShortcutRegistrationWrite,
  applyServerRecentRepoAddWrite,
  applyServerRecentRepoClearWrite,
  applyServerSessionWrite,
  applyServerSettingsPrefsWrite,
} from '#/server/modules/settings-write-paths.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'
import type { LanInfo } from '#/shared/rpc.ts'

export function createSettingsRoutes() {
  const app = new Hono()
  app.get('/', async (c) => c.json(await getSettingsSnapshot()))
  app.get('/i18n', async (c) => c.json(await getServerI18nSnapshot(c.req.header('accept-language'))))
  app.get('/github-cli', async (c) => {
    const hosts = (c.req.queries('host') ?? []).filter((host): host is string => typeof host === 'string' && host.length > 0)
    return c.json(await getServerGitHubCliState(c.req.raw.signal, hosts))
  })
  app.post('/github-cli/refresh', async (c) => {
    const body = await c.req.json().catch(() => null)
    const hosts = Array.isArray(body?.hosts)
      ? body.hosts.filter((host: unknown): host is string => typeof host === 'string' && host.length > 0)
      : undefined
    return c.json(await getServerGitHubCliState(c.req.raw.signal, hosts, { force: true }))
  })
  app.get('/external-apps', async (c) => c.json(await getServerExternalAppsSnapshot(c.req.raw.signal)))
  app.post('/external-apps/refresh', async (c) => c.json(await getServerExternalAppsSnapshot(c.req.raw.signal)))
  app.get('/prefs', async (c) => c.json(await getServerSettingsPrefs()))
  app.get('/lan', async (c) => {
    const host = process.env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
    const port = Number(process.env.GOBLIN_SERVER_PORT) || 32100
    const lanUrls = host === '0.0.0.0' ? getLanUrls(port) : isLanAddress(host) ? [`http://${host}:${port}`] : []
    return c.json({ host, port, lanUrls } satisfies LanInfo)
  })
  app.post('/fetch-interval', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await applyServerFetchIntervalWrite(body))
  })
  app.post('/prefs', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(
      await applyServerSettingsPrefsWrite(body, {
        acceptLanguage: c.req.header('accept-language'),
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/global-shortcut-state', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(applyServerGlobalShortcutRegistrationWrite(body))
  })
  app.post('/session', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await applyServerSessionWrite(body))
  })
  app.post('/recent-repos/add', async (c) => {
    const body = await c.req.json().catch(() => null)
    return c.json(await applyServerRecentRepoAddWrite(body))
  })
  app.post('/recent-repos/clear', async (c) => c.json(await applyServerRecentRepoClearWrite()))
  return app
}
