import { getServerExternalAppsSnapshot } from '#/server/modules/external-apps.ts'
import { getServerGitHubCliState } from '#/server/modules/github-cli.ts'
import { getServerI18nSnapshot } from '#/server/modules/i18n.ts'
import { getSettingsSnapshot } from '#/server/modules/settings-snapshot.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import type { ServerSettingsState } from '#/server/modules/settings-state.ts'
import {
  applyServerFetchIntervalWrite,
  applyServerGlobalShortcutRegistrationWrite,
  applyServerRecentRepoAddWrite,
  applyServerRecentRepoClearWrite,
  applyServerSessionWrite,
  applyServerSettingsPrefsWrite,
} from '#/server/modules/settings-write-paths.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'
import type { LanInfo } from '#/shared/api-types.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import {
  GITHUB_CLI_REFRESH_SCHEMA,
  SETTINGS_PATCH_SCHEMAS,
  SETTINGS_PROCEDURE_SCHEMAS,
} from '#/shared/procedure-schemas.ts'

export function createSettingsRoutes(settingsState: ServerSettingsState) {
  const app = createRouteApp()
  app.get('/', async (c) => c.json(await getSettingsSnapshot(settingsState)))
  app.get('/github-cli', async (c) => {
    const hosts = (c.req.queries('host') ?? []).filter(
      (host): host is string => typeof host === 'string' && host.length > 0,
    )
    return c.json(await getServerGitHubCliState(c.req.raw.signal, hosts))
  })
  app.post('/github-cli/refresh', async (c) => {
    const parsed = await parseHttpBody(GITHUB_CLI_REFRESH_SCHEMA, c)
    return c.json(await getServerGitHubCliState(c.req.raw.signal, parsed.hosts, { force: true }))
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
    const { sec } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.fetchInterval, c)
    return c.json(await applyServerFetchIntervalWrite({ sec }))
  })
  app.post('/prefs', async (c) => {
    const { settings } = await parseHttpBody(SETTINGS_PATCH_SCHEMAS.prefs, c)
    return c.json(
      await applyServerSettingsPrefsWrite(
        { settings },
        {
          acceptLanguage: c.req.header('accept-language'),
          signal: c.req.raw.signal,
        },
      ),
    )
  })
  app.post('/global-shortcut-state', async (c) => {
    const { registered } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.globalShortcutState, c)
    return c.json(applyServerGlobalShortcutRegistrationWrite({ registered }, settingsState))
  })
  app.post('/session', async (c) => {
    const { session } = await parseHttpBody(SETTINGS_PATCH_SCHEMAS.session, c)
    return c.json(await applyServerSessionWrite({ session }))
  })
  app.post('/recent-repos/add', async (c) => {
    const { repo } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.recentReposAdd, c)
    return c.json(await applyServerRecentRepoAddWrite({ repo }))
  })
  app.post('/recent-repos/clear', async (c) => c.json(await applyServerRecentRepoClearWrite()))
  return app
}
