import { getServerExternalAppsSnapshot } from '#/server/modules/external-apps.ts'
import { getServerGitHubCliState } from '#/server/modules/github-cli.ts'
import { getSettingsSnapshot } from '#/server/modules/settings-snapshot.ts'
import { getUserSettings } from '#/server/modules/settings-source.ts'
import { restoreRepoTabsForRepo, restoreServerWorkspace } from '#/server/modules/session-restore.ts'
import type { NativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import {
  handleSetFetchInterval,
  handleSetGlobalShortcutRegistered,
  handleAddRecentRepo,
  handleClearRecentRepos,
  handleSetRepoWorkspaceExternalAppRecent,
  handleUpdateUserSettings,
} from '#/server/modules/settings-write-paths.ts'
import { getLanUrls, isLanAddress } from '#/shared/lan-addresses.ts'
import type { LanInfo } from '#/shared/api-types.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import {
  GITHUB_CLI_REFRESH_SCHEMA,
  SETTINGS_PATCH_SCHEMAS,
  SETTINGS_PROCEDURE_SCHEMAS,
} from '#/shared/procedure-schemas.ts'

export function createSettingsRoutes(options: {
  settingsState: NativeShortcutRegistrationState
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
}) {
  const { settingsState, workspacePaneTabsHost } = options
  const app = createRouteApp()
  app.get('/', async (c) => c.json(await getSettingsSnapshot(settingsState)))
  app.post('/github-cli', async (c) => {
    const { hosts } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.githubCli, c)
    return c.json(await getServerGitHubCliState(c.req.raw.signal, hosts))
  })
  app.post('/github-cli/refresh', async (c) => {
    const parsed = await parseHttpBody(GITHUB_CLI_REFRESH_SCHEMA, c)
    return c.json(await getServerGitHubCliState(c.req.raw.signal, parsed.hosts, { force: true }))
  })
  app.get('/external-apps', async (c) => c.json(await getServerExternalAppsSnapshot(c.req.raw.signal)))
  app.post('/external-apps/refresh', async (c) => c.json(await getServerExternalAppsSnapshot(c.req.raw.signal)))
  app.get('/prefs', async (c) => c.json(await getUserSettings()))
  app.get('/lan', async (c) => {
    const host = process.env.GOBLIN_SERVER_HOST?.trim() || '127.0.0.1'
    const port = Number(process.env.GOBLIN_SERVER_PORT) || 32100
    const lanUrls = host === '0.0.0.0' ? getLanUrls(port) : isLanAddress(host) ? [`http://${host}:${port}`] : []
    return c.json({ host, port, lanUrls } satisfies LanInfo)
  })
  app.post('/fetch-interval', async (c) => {
    const { sec } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.fetchInterval, c)
    return c.json(await handleSetFetchInterval({ sec }))
  })
  app.post('/prefs', async (c) => {
    const { prefs } = await parseHttpBody(SETTINGS_PATCH_SCHEMAS.prefs, c)
    return c.json(
      await handleUpdateUserSettings(
        { prefs },
        {
          acceptLanguage: c.req.header('accept-language'),
          signal: c.req.raw.signal,
        },
      ),
    )
  })
  app.post('/global-shortcut-state', async (c) => {
    const { registered } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.globalShortcutState, c)
    return c.json(handleSetGlobalShortcutRegistered({ registered }, settingsState))
  })
  app.post('/workspace/restore', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { clientId, openRepoEntries, activeRepoRoot } = await parseHttpBody(
      SETTINGS_PROCEDURE_SCHEMAS.workspaceRestore,
      c,
    )
    return c.json(
      await restoreServerWorkspace({
        userId,
        clientId,
        openRepoEntries,
        activeRepoRoot: activeRepoRoot ?? null,
        workspacePaneTabsHost,
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/workspace/restore-repo-tabs', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { clientId, repoRoot, repoRuntimeId, intent } = await parseHttpBody(
      SETTINGS_PROCEDURE_SCHEMAS.restoreRepoTabs,
      c,
    )
    return c.json(
      await restoreRepoTabsForRepo({
        userId,
        clientId,
        repoRoot,
        repoRuntimeId,
        intent,
        workspacePaneTabsHost,
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/recent-repos/add', async (c) => {
    const { repo } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.recentReposAdd, c)
    return c.json(await handleAddRecentRepo({ repo }))
  })
  app.post('/recent-repos/clear', async (c) => c.json(await handleClearRecentRepos()))
  app.post('/repo-external-app-recent', async (c) => {
    const { repoId, worktreePath, itemId } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.repoExternalAppRecentSet, c)
    return c.json(await handleSetRepoWorkspaceExternalAppRecent({ repoId, worktreePath, itemId }))
  })
  return app
}
