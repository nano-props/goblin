import { getServerExternalAppsSnapshot } from '#/server/modules/external-apps.ts'
import { getServerGitHubCliState } from '#/server/modules/github-cli.ts'
import { getSettingsSnapshot } from '#/server/modules/settings-snapshot.ts'
import {
  addServerWorkspaceEntry,
  getUserSettings,
  removeServerWorkspaceEntry,
} from '#/server/modules/settings-source.ts'
import { restoreServerWorkspace } from '#/server/modules/session-restore.ts'
import { restoreWorkspaceTabs } from '#/server/modules/workspace-tabs-restore.ts'
import type { NativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import {
  handleSetFetchInterval,
  handleSetGlobalShortcutRegistered,
  handleAddRecentWorkspace,
  handleClearRecentWorkspaces,
  handleSetWorkspaceExternalAppRecent,
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
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
}) {
  const { settingsState, workspacePaneTabsHost, workspaceCapabilityTransitionHost } = options
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
    const { clientId, activeWorkspaceId } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.workspaceRestore, c)
    return c.json(
      await restoreServerWorkspace({
        userId,
        clientId,
        activeWorkspaceId: activeWorkspaceId ?? null,
        workspacePaneTabsHost,
        workspaceCapabilityTransitionHost,
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/workspace/entries/add', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { entry } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.workspaceEntryAdd, c)
    return c.json(await addServerWorkspaceEntry(entry))
  })
  app.post('/workspace/entries/remove', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { workspaceId } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.workspaceEntryRemove, c)
    return c.json(await removeServerWorkspaceEntry(workspaceId))
  })
  app.post('/workspace/tabs/restore', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { clientId, workspaceId, workspaceRuntimeId } = await parseHttpBody(
      SETTINGS_PROCEDURE_SCHEMAS.restoreWorkspaceTabs,
      c,
    )
    return c.json(
      await restoreWorkspaceTabs({
        userId,
        clientId,
        workspaceId,
        workspaceRuntimeId,
        workspacePaneTabsHost,
        workspaceCapabilityTransitionHost,
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/recent-workspaces/add', async (c) => {
    const { workspace } = await parseHttpBody(SETTINGS_PROCEDURE_SCHEMAS.recentWorkspacesAdd, c)
    return c.json(await handleAddRecentWorkspace({ workspace }))
  })
  app.post('/recent-workspaces/clear', async (c) => c.json(await handleClearRecentWorkspaces()))
  app.post('/workspace-external-app-recent', async (c) => {
    const { workspaceId, targetKey, itemId } = await parseHttpBody(
      SETTINGS_PROCEDURE_SCHEMAS.workspaceExternalAppRecentSet,
      c,
    )
    return c.json(await handleSetWorkspaceExternalAppRecent({ workspaceId, targetKey, itemId }))
  })
  return app
}
