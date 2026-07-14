import { Hono } from 'hono'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createNativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

const mocks = vi.hoisted(() => ({
  getServerExternalAppsSnapshot: vi.fn(),
  getServerGitHubCliState: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  getUserSettings: vi.fn(),
  handleSetFetchInterval: vi.fn(),
  handleSetGlobalShortcutRegistered: vi.fn(),
  handleAddRecentRepo: vi.fn(),
  handleClearRecentRepos: vi.fn(),
  handleSetSession: vi.fn(),
  handleUpdateUserSettings: vi.fn(),
  restoreServerWorkspaceSession: vi.fn(),
}))

vi.mock('#/server/modules/external-apps.ts', () => ({
  getServerExternalAppsSnapshot: mocks.getServerExternalAppsSnapshot,
}))

vi.mock('#/server/modules/github-cli.ts', () => ({
  getServerGitHubCliState: mocks.getServerGitHubCliState,
}))

vi.mock('#/server/modules/settings-snapshot.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getUserSettings: mocks.getUserSettings,
}))

vi.mock('#/server/modules/settings-write-paths.ts', () => ({
  handleSetFetchInterval: mocks.handleSetFetchInterval,
  handleSetGlobalShortcutRegistered: mocks.handleSetGlobalShortcutRegistered,
  handleAddRecentRepo: mocks.handleAddRecentRepo,
  handleClearRecentRepos: mocks.handleClearRecentRepos,
  handleSetSession: mocks.handleSetSession,
  handleUpdateUserSettings: mocks.handleUpdateUserSettings,
}))

vi.mock('#/server/modules/session-restore.ts', () => ({
  restoreServerWorkspaceSession: mocks.restoreServerWorkspaceSession,
}))

const workspacePaneTabsHostStub = {
  listWorkspaceTabs: vi.fn(),
  replaceTabs: vi.fn(),
  updateTabs: vi.fn(),
} satisfies ServerWorkspacePaneTabsHost

function settingsRouteOptions() {
  return {
    settingsState: createNativeShortcutRegistrationState(),
    workspacePaneTabsHost: workspacePaneTabsHostStub,
  }
}

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('delegates prefs writes to the settings command handler layer', async () => {
    mocks.handleUpdateUserSettings.mockResolvedValue({
      ok: true,
      prefs: { lang: 'ja' },
      i18n: { lang: 'ja', pref: 'ja', dict: {} },
    })

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
        },
        body: JSON.stringify({ prefs: { lang: 'ja' } }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      prefs: { lang: 'ja' },
      i18n: { lang: 'ja', pref: 'ja', dict: {} },
    })
    expect(mocks.handleUpdateUserSettings).toHaveBeenCalledWith(
      { prefs: { lang: 'ja' } },
      { acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8', signal: expect.any(AbortSignal) },
    )
  })

  test('delegates session writes to the settings command handler layer', async () => {
    const session = {
      openRepoEntries: [],
      restoredRepoId: null,
      zenMode: true,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {},
      filetreeViewStateByWorktreeByRepo: {},
    } as const
    mocks.handleSetSession.mockResolvedValue({ ok: true, session })

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      session,
    })
    expect(mocks.handleSetSession).toHaveBeenCalledWith({ session })
  })

  test('delegates session restore to the server restore coordinator', async () => {
    const restored = {
      status: 'restored' as const,
      session: {
        openRepoEntries: [],
        restoredRepoId: null,
        zenMode: false,
        workspacePaneSize: 45,
        selectedTerminalSessionIdByTerminalWorktree: {},
        preferredWorkspacePaneTabByTargetByRepo: {},
        workspacePaneTabsByTargetByRepo: {},
        filetreeViewStateByWorktreeByRepo: {},
      },
      runtime: { repos: [], workspacePaneTabs: [], restoredRepoId: null },
    }
    mocks.restoreServerWorkspaceSession.mockResolvedValue(restored)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request(
      new Request('http://127.0.0.1:32100/session/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'client_test000000000000', activeRepoRoot: '/repo-active' }),
      }),
    )

    await expect(response.json()).resolves.toEqual(restored)
    expect(mocks.restoreServerWorkspaceSession).toHaveBeenCalledWith({
      userId: 'user-test',
      clientId: 'client_test000000000000',
      activeRepoRoot: '/repo-active',
      workspacePaneTabsHost: workspacePaneTabsHostStub,
      signal: expect.any(AbortSignal),
    })
  })

  test('rejects session restore without an authenticated user id', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())

    const response = await app.request(
      new Request('http://127.0.0.1:32100/session/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'client_test000000000000' }),
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, message: 'Unauthorized' })
    expect(mocks.restoreServerWorkspaceSession).not.toHaveBeenCalled()
  })

  test('rejects session restore when client id is invalid', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = new Hono<{ Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', 'user-test')
      await next()
    })
    app.route('/', createSettingsRoutes(settingsRouteOptions()))

    const response = await app.request(
      new Request('http://127.0.0.1:32100/session/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.restoreServerWorkspaceSession).not.toHaveBeenCalled()
  })

  test('accepts a session state with files in preferred tab and mixed tab list picklist', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/tmp/repo',
      branchName: 'feature/worktree',
      worktreePath: '/tmp/repo-worktree',
    })
    const session = {
      openRepoEntries: [],
      restoredRepoId: null,
      zenMode: true,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {},
      preferredWorkspacePaneTabByTargetByRepo: { '/tmp/repo': { [targetKey]: 'files' } },
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo': {
          [targetKey]: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'files', tabId: 'workspace-pane:files' },
          ],
        },
      },
      filetreeViewStateByWorktreeByRepo: {},
    } as const
    mocks.handleSetSession.mockResolvedValue({ ok: true, session })

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.handleSetSession).toHaveBeenCalledWith({ session })
  })

  test('delegates recent-repo writes to the settings command handler layer', async () => {
    const repo = { kind: 'local', id: '/tmp/repo-a' } as const
    mocks.handleAddRecentRepo.mockResolvedValue({ ok: true, recentRepos: [repo], addedRepo: repo })
    mocks.handleClearRecentRepos.mockResolvedValue({ ok: true })
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())

    const addResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-repos/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo }),
      }),
    )
    await expect(addResponse.json()).resolves.toEqual({
      ok: true,
      recentRepos: [repo],
      addedRepo: repo,
    })
    expect(mocks.handleAddRecentRepo).toHaveBeenCalledWith({ repo })

    const clearResponse = await app.request(
      new Request('http://127.0.0.1:32100/recent-repos/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(clearResponse.json()).resolves.toEqual({ ok: true })
    expect(mocks.handleClearRecentRepos).toHaveBeenCalled()
  })

  test('returns 400 BAD_REQUEST when the body is missing required fields', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/fetch-interval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.handleSetFetchInterval).not.toHaveBeenCalled()
  })

  test('returns 400 when global-shortcut-state body has wrong type for `registered`', async () => {
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/global-shortcut-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ registered: 'yes' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.handleSetGlobalShortcutRegistered).not.toHaveBeenCalled()
  })

  test('delegates github-cli detection to the server module, scoping by hosts when provided', async () => {
    const state = {
      available: true,
      version: '2.93.0',
      detectedAt: 1,
      hosts: { 'github.example.com': { authed: true } },
    }
    mocks.getServerGitHubCliState.mockResolvedValue(state)
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())

    const hostsResponse = await app.request(
      new Request('http://127.0.0.1:32100/github-cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['github.example.com'] }),
      }),
    )
    await expect(hostsResponse.json()).resolves.toEqual(state)
    expect(mocks.getServerGitHubCliState).toHaveBeenLastCalledWith(expect.any(AbortSignal), ['github.example.com'])

    const emptyResponse = await app.request(
      new Request('http://127.0.0.1:32100/github-cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    await expect(emptyResponse.json()).resolves.toEqual(state)
    expect(mocks.getServerGitHubCliState).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined)
  })

  test('returns 400 when hosts is a string instead of an array', async () => {
    // Schema is `v.optional(v.array(v.string()))`. The previous
    // query-string mode coerced query values to strings, so this
    // shape was unreachable; POST body makes it possible to send
    // a bare string and now the schema must reject it.
    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes(settingsRouteOptions())
    const response = await app.request(
      new Request('http://127.0.0.1:32100/github-cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: 'github.example.com' }),
      }),
    )
    expect(response.status).toBe(400)
    const json = (await response.json()) as { code: string }
    expect(json.code).toBe('BAD_REQUEST')
    expect(mocks.getServerGitHubCliState).not.toHaveBeenCalled()
  })
})
