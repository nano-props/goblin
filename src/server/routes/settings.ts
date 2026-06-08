import { Hono } from 'hono'
import { publishSettingsInvalidation } from '#/server/modules/invalidation-broker.ts'
import { buildServerExternalAppsSnapshot, getServerExternalAppsSnapshot } from '#/server/modules/external-apps.ts'
import { getServerGitHubCliState } from '#/server/modules/github-cli.ts'
import { buildServerI18nPayload, getServerI18nPayload } from '#/server/modules/i18n.ts'
import { getSettingsSnapshot, setServerGlobalShortcutRegistered } from '#/server/modules/settings.ts'
import {
  addServerRecentRepo,
  clearServerRecentRepos,
  getServerSettingsPrefs,
  setServerFetchIntervalSec,
  setServerSessionState,
  updateServerSettingsPrefs,
} from '#/server/modules/settings-source.ts'
import { toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'
import type { LanInfo, SettingsPrefsUpdateResponse } from '#/shared/rpc.ts'
import { repoSessionEntryId } from '#/shared/remote-repo.ts'
import { settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

export function createSettingsRoutes() {
  const app = new Hono()
  app.get('/', async (c) => c.json(await getSettingsSnapshot()))
  app.get('/i18n', async (c) => c.json(await getServerI18nPayload(c.req.header('accept-language'))))
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
    const sec = typeof body?.sec === 'number' ? body.sec : 0
    const next = await setServerFetchIntervalSec(sec)
    publishSettingsInvalidation(['settings-snapshot'])
    return c.json({ ok: true, fetchIntervalSec: next })
  })
  app.post('/prefs', async (c) => {
    const body = await c.req.json().catch(() => null)
    const patch = (body?.settings ?? {}) as Record<string, unknown>
    const settings = await updateServerSettingsPrefs(patch)
    publishSettingsInvalidation(settingsInvalidationScopesForPrefsPatch(patch))
    return c.json({
      ok: true,
      settings,
      ...('lang' in patch ? { i18n: buildServerI18nPayload(settings, c.req.header('accept-language')) } : {}),
      ...(patch.terminalApp !== undefined || patch.editorApp !== undefined
        ? { externalApps: await buildServerExternalAppsSnapshot(settings, c.req.raw.signal) }
        : {}),
    } satisfies SettingsPrefsUpdateResponse)
  })
  app.post('/global-shortcut-state', async (c) => {
    const body = await c.req.json().catch(() => null)
    const registered = setServerGlobalShortcutRegistered(body?.registered === true)
    publishSettingsInvalidation(['settings-snapshot'])
    return c.json({ ok: true, registered })
  })
  app.post('/session', async (c) => {
    const body = await c.req.json().catch(() => null)
    const session = await setServerSessionState(body?.session)
    publishSettingsInvalidation(['session'])
    return c.json({ ok: true, session })
  })
  app.post('/recent-repos/add', async (c) => {
    const body = await c.req.json().catch(() => null)
    const requestedRepo = toSafeSessionRepoEntry(body?.repo)
    const recentRepos = await addServerRecentRepo(body?.repo)
    const addedRepo =
      requestedRepo && recentRepos.length > 0 && repoSessionEntryId(recentRepos[0]) === repoSessionEntryId(requestedRepo)
        ? recentRepos[0]
        : null
    publishSettingsInvalidation(['settings-snapshot'])
    return c.json({ ok: true, recentRepos, addedRepo })
  })
  app.post('/recent-repos/clear', async (c) => {
    await clearServerRecentRepos()
    publishSettingsInvalidation(['settings-snapshot'])
    return c.json({ ok: true })
  })
  return app
}
